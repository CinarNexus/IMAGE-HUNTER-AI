# Image Hunter AI

SerpApi üzerinden gerçek Google Görseller sonuçlarını arayan, Gemini ile görsel başına analiz edip puanlayan ve seçilen görselleri kaynak bilgileriyle ZIP'e ekleyen Türkçe görsel keşif uygulaması.

## Gereksinimler

- Node.js 20 veya üzeri
- SerpApi API anahtarı (Google Görseller araması için)
- Google Gemini API anahtarı (gerçek AI analizi için)

Uygulama anahtarlar olmadan sahte arama veya AI analizi üretmez. Anahtar yapılandırılmadığında arama/analiz uç noktası açık bir hata döndürür.

## API anahtarları

1. [SerpApi hesabınızda](https://serpapi.com/manage-api-key) API anahtarınızı bulun.
2. Google AI Studio'da [Gemini API anahtarı oluşturun](https://aistudio.google.com/app/apikey).
3. Proje kökündeki `.env.example` dosyasını `.env` olarak kopyalayın (veya mevcut boş `.env` dosyasını kullanın).
4. SerpApi anahtarını `.env` dosyasındaki `SERPAPI_API_KEY=` satırında eşittir işaretinden sonra; Gemini anahtarını `GEMINI_API_KEY=` satırına ekleyin:

   ```dotenv
   SERPAPI_API_KEY=serpapi_anahtariniz
   GEMINI_API_KEY=gemini_anahtariniz
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3001
   ```

`.env` Git tarafından yok sayılır. API anahtarlarını frontend kaynaklarına, Git'e veya sohbete eklemeyin. Anahtarları ekledikten sonra backend'i yeniden başlatın. Anahtar değeri boş olan örnek dosyayı hiçbir zaman gerçek anahtarla commit etmeyin.

SerpApi aramaları hesap kotanızdan arama kredisi kullanabilir. Bu uygulama ücretli plan başlatmaz, ödeme yöntemi eklemez veya otomatik ödemeyi açmaz. Yalnızca mevcut SerpApi hesabınızı kullanır; ücretsiz kota ve olası ücretleri arama yapmadan önce [SerpApi plan/kullanım sayfasından](https://serpapi.com/pricing) kontrol edin. Ücretli kullanımı/otomatik yenilemeyi hesap ayarlarınızda kendiniz etkinleştirmediğinizden emin olun.

## Kurulum ve çalıştırma

```bash
npm install
npm run dev
```

`npm run dev` frontend (Vite) ve backend (Express) sunucularını birlikte başlatır. Vite geliştirme arayüzü [http://localhost:5173](http://localhost:5173) adresinde açılır; başka bir süreç bu portu kullanıyorsa Vite kullanılabilir sonraki porta geçer. API sunucusu varsayılan olarak `http://127.0.0.1:3001` üzerinde çalışır. İki süreci ayrı çalıştırmak için `npm run dev:client` ve `npm run server` komutlarını iki terminalde kullanabilirsiniz.

Üretim derlemesi ve sunucusu:

```bash
npm run build
npm start
```

Üretim sunucusu `dist` klasörünü Express üzerinden sunar.

## Özellikler

- SerpApi Google Görseller araması: ilk aşamada hedefe göre 20 veya 100 aday; yeterli uygun sonuç yoksa en fazla bir ek sayfa
- Gemini öncesi URL/erişim, en az 300 px kısa kenar ve 120.000 toplam piksel çözünürlük, bozuk görsel ve pHash benzerlik filtreleri
- Gemini kişi filtresi: fotoğrafta tam bir insan, doğrulanmış aranan kimlik ve görünür/tanınabilir yüz zorunlu; bu filtrelerden geçmeyen fotoğraflara estetik puan uygulanmaz ve seçilemez
- Gemini görsel analizi: filtreyi geçen fotoğraflarda alaka, netlik, çözünürlük, ışık, renk, kompozisyon, kadraj ve edit uygunluğu için ağırlıklı 100 puanlık estetik değerlendirme
- Doğrulanmış, benzersiz ve en az 45 puanlı görseller arasından puanı en yüksek 20 veya 100 görseli otomatik seçme
- Kaynak sayfası, kaynak adı ve mevcutsa çözünürlük bilgileri
- Seçilen görselleri ve kaynak/lisans manifestini ZIP olarak indirme
- Arama geçmişi, manuel seçim, tümünü seçme ve tekrar arama

Analiz sonuçları Gemini tarafından üretilir; görsel indirilemez veya AI yanıtı doğrulanamazsa sonuç puan uydurmak yerine analiz hatası olarak gösterilir. ZIP oluşturulurken erişilemeyen görseller atlanır ve manifestte belirtilir. Google Görseller sonucu kullanım lisansı anlamına gelmez; her görselin telif ve kullanım koşullarını kaynak sayfasında kontrol edin.
