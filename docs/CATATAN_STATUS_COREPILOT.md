# Status CorePilot — 14 Oktober 2026

## Untuk demo juri

CorePilot mempunyai landing page, Explore, detail strategi, Create, My Strategies, Activity, Overview, dan monitor simulasi. Fokus MVP operasional adalah **Funding Rate → Open Position**. UI memisahkan data demo, snapshot pasar, otorisasi CorePilot, intent, receipt CorePilot, serta bukti order/fill venue. Jangan presentasikan data simulasi atau `ADAPTER_REQUESTED` sebagai fill HyperCore.

Preview lokal: `http://127.0.0.1:5173/`. API: `http://127.0.0.1:8001/api/health`. Pada pemeriksaan terakhir, web HTTP 200 dan API melaporkan database operasional. PostgreSQL CorePilot berjalan sebagai cluster terpisah di `127.0.0.1:55432` dalam `.local/postgres`; service PostgreSQL lama tidak diubah. Kedua server dev dapat berhenti ketika sesi terminal berakhir.

## Yang benar-benar sudah dibangun

| Lapisan | Status |
|---|---|
| Elysium testnet | Stack kontrak final di-deploy ke chain `99801`. Semua 11 transaksi final sukses; hubungan PILOT, staking, registry, oracle, controller, adapter, dan receipt dibaca ulang dari chain dan cocok dengan source. Registry baru masih kosong (`nextStrategyId=1`). Alamat final ada di `deployments/elysium-testnet.json`; satu deployment perantara dan alamat awal diarsipkan di sana. Token testnet menyediakan faucet 10.000 PILOT per wallet, cukup untuk bond minimum 5.000; `mint` dibatasi ke deployer. |
| Konfigurasi | Alamat publik baru tersinkron ke `apps/api/.env`, `apps/web/.env`, dan `apps/executor/.env`. Secret agent, password database, dan private key deployer tetap hanya di file lokal yang diabaikan Git. Jangan jalankan `scripts/setup-testnet.ps1` pada konfigurasi ini karena script tersebut dapat menimpa `.env`. |
| Database | PostgreSQL lokal dan tabel policy, otorisasi, agent, trigger, intent, venue receipt, serta rekonsiliasi tersedia. Kolom `venue_receipts.client_order_id` ditambah dengan SQL terarah setelah `drizzle-kit push` berikutnya gagal mencoba mengubah constraint primary key; jangan jalankan ulang `db:push` membabi buta. Schema perlu migrasi SQL yang ditinjau sebelum dipakai di lingkungan lain. |
| Policy dan otorisasi | Policy kreator dan batas trader ditandatangani, diverifikasi, dan tersimpan. Pause/Resume/Revoke memerlukan tanda tangan baru. Batas efektif adalah batas yang lebih ketat; renewal tidak otomatis mencabut otorisasi lama. |
| Trading access | Agent **testnet-only** lokal sudah dibuat, tetapi belum disetujui oleh akun trader di HyperCore testnet. Alamat publik agent: `0xc4CB91536AA0F5ac67AE02D225B395246865fd68`. UI menyediakan grant trader bertanda tangan dan verifikasi relasi venue. Native agent venue dapat memiliki kewenangan lebih luas daripada guard CorePilot; gunakan akun testnet khusus. |
| Watcher dan intent | Watcher API aktif secara opt-in, memantau funding HYPE HyperCore **mainnet** sebagai sinyal, menyimpan snapshot/trigger, dan hanya membuat intent bila policy, otorisasi, bond, serta agent venue valid. Selama agent belum disetujui, tidak ada intent yang boleh dipaksa lewat. |
| Order worker | Worker HyperCore **testnet** tersedia, dengan IOC quote, leverage terikat, client order ID deterministik, pencatatan `SUBMITTING` sebelum request, dan rekonsiliasi terbatas. `EXECUTOR_ENABLE_TESTNET_ORDERS=false`; worker belum diaktifkan dan **belum ada bukti order/fill nyata**. |

Alur sasaran adalah: `wallet → deployment/policy/bond → trader authorization → agent testnet → watcher → trigger → intent → order HyperCore testnet → venue receipt/fill`. Implementasi source tidak sama dengan uji end-to-end: hingga kini jalur tersebut **belum selesai divalidasi memakai wallet trader dan order nyata**.

## Yang masih kurang dan aksi aman berikutnya

1. Dengan wallet testnet khusus, buat dan bond satu strategi pada registry baru, tanda tangani policy kreator, lalu aktifkan otorisasi trader. Registry kosong berarti strategi lama pada deployment sebelumnya tidak otomatis pindah.
2. Di pengaturan HyperCore **testnet**, setujui alamat agent publik di atas untuk akun uji trader. Jangan kirim private key/seed phrase melalui chat. Setelah itu tanda tangani grant Trading Access di My Strategies dan pastikan API menampilkan `ACTIVE`, bukan sekadar `UNVERIFIED`.
3. Uji watcher membuat satu intent dari snapshot segar ketika kondisi benar-benar memenuhi threshold. Verifikasi duplicate suppression, expiry, pause/revoke, dan batas efektif. Tidak perlu memanipulasi data venue untuk demo.
4. Hanya setelah akun testnet, saldo, ukuran minimum order, dan batas risiko dikonfirmasi, aktifkan worker order secara sengaja untuk **satu order kecil**. Cocokkan client order ID, order ID, status, filled size, harga, dan bukti venue. Bila status request tidak pasti, rekonsiliasi; jangan kirim ulang secara buta.
5. Buat migrasi database ter-review untuk lingkungan baru dan tambah tes integrasi DB/worker serta QA klik dengan wallet. Ini diperlukan sebelum mengklaim kesiapan produksi.

## Bukti validasi terakhir

- `forge test`: 23/23 lulus, termasuk faucet dan pembatasan mint. Simulasi deploy final sukses dan broadcast 11/11 receipt sukses; verifikasi pembacaan hubungan kontrak final dijalankan ulang setelah sinkronisasi alamat.
- `pnpm -r --if-present typecheck`, tes API/executor/SDK/web helper, dan build web lulus pada pemeriksaan sebelumnya. Peringatan chunk web >500 kB bukan kegagalan build.
- Sinyal HYPE funding HyperCore mainnet pernah diambil live dengan waktu receipt; itu bukan bukti order testnet.
- `git diff --check` lulus. Banyak perubahan repo masih belum di-commit; jangan reset/checkout secara destruktif.

## Pemulihan lokal

Jika cluster CorePilot berhenti, jalankan `pg_ctl` PostgreSQL 18 terhadap `C:\Users\Antidump\Downloads\CorePilot\.local\postgres`, dengan opsi `-h 127.0.0.1 -p 55432`; **jangan** jalankan ulang initializer. Setelah itu:

```powershell
pnpm --filter @corepilot/api dev
pnpm --filter @corepilot/web dev --host 127.0.0.1
```

Jangan menyalakan `pnpm --filter @corepilot/executor testnet:worker` atau mengubah `EXECUTOR_ENABLE_TESTNET_ORDERS` sebelum langkah agent dan preflight selesai. Lihat juga [arsitektur](./architecture.md) dan [panduan deploy](./deploy-testnet.md).
