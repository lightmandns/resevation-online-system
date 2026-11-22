import { restaurantRepository } from '../repositories/restaurantRepository.js';

export const restaurantService = {
  /**
   * E06 — GET /api/v1/public/restaurant
   */
  async getPublicInfo() {
    let settings: Record<string, string> = {};
    try {
      settings = await restaurantRepository.getPublicSettings();
    } catch {
      settings = {};
    }

    const jamBuka = settings.jam_buka || '10:00';
    const jamTutup = settings.jam_tutup || '22:00';
    const whatsappAdmin = settings.whatsapp_admin || '6281234567890';

    return {
      profil: {
        nama: 'Mazaya Resto & Swimming Pool',
        deskripsi:
          'Restoran keluarga yang menyajikan kombinasi hidangan lokal dan western dimasak segar (cooked to order), dilengkapi area kolam renang, gazebo, dan ruang acara.',
        jam_operasional: {
          buka: jamBuka,
          tutup: jamTutup,
          zona_waktu: 'WIB (+07:00)',
        },
      },
      alamat: 'Jl. Restoran Mazaya, Karanganyar / Surakarta, Jawa Tengah',
      lokasi: {
        lat: -7.5755,
        lng: 110.8243,
      },
      fasilitas: [
        'Kolam Renang (Swimming Pool)',
        'Gazebo & Area Outdoor',
        'Ruang Indoor Ber-AC',
        'Area Parkir Luas',
        'Mushola',
        'Wi-Fi Gratis',
        'Venue Acara Khusus (Pernikahan, Gathering, Ulang Tahun)',
      ],
      faq: [
        {
          pertanyaan: 'Bagaimana cara melakukan reservasi tempat di Restoran Mazaya?',
          jawaban:
            'Silakan daftar atau masuk ke akun Anda, pilih layanan Reguler, tentukan tanggal & jam kedatangan, pilih blok meja pada denah visual, lalu selesaikan pembayaran DP.',
        },
        {
          pertanyaan: 'Apakah uang muka (DP) yang sudah dibayarkan dapat di-refund?',
          jawaban:
            'Tidak. Seluruh transaksi pembayaran DP maupun pelunasan menu yang telah berhasil tidak dapat di-refund.',
        },
        {
          pertanyaan: 'Kapan saya bisa memesan menu (pre-order)?',
          jawaban:
            'Pemesanan menu dapat dilakukan setelah pembayaran DP terverifikasi, maksimal sampai H-1 sebelum jadwal reservasi.',
        },
        {
          pertanyaan: 'Bagaimana ketentuan untuk Menu Request di luar daftar menu?',
          jawaban:
            'Menu Request memerlukan pemesanan minimal 20 porsi beserta deskripsi hidangan dan akan ditinjau oleh Admin untuk penetapan harga.',
        },
        {
          pertanyaan: 'Bagaimana jika ingin memesan untuk acara besar seperti pernikahan atau party?',
          jawaban:
            'Pilih opsi Layanan Khusus pada halaman reservasi agar diarahkan langsung ke WhatsApp Admin Restoran Mazaya.',
        },
      ],
      kontak: {
        whatsapp: whatsappAdmin,
        whatsapp_url: `https://wa.me/${whatsappAdmin}`,
        email: 'info@restoranmazaya.id',
      },
      media_sosial: [
        { platform: 'Instagram', handle: '@mazayaresto', url: 'https://instagram.com/mazayaresto' },
        { platform: 'TikTok', handle: '@mazayaresto', url: 'https://tiktok.com/@mazayaresto' },
      ],
      galeri: [],
    };
  },
};
