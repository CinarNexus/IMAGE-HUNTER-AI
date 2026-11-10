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
- Gemini öncesi URL/erişim, en az 300 px kısa kenar ve 120.000 toplam piksel çözünürlük ve bozuk görsel filtreleri; yalnızca normalize edilmiş içeriği birebir aynı olan görseller analiz paylaşır
- Gemini kişi filtresi: arka plan ve küçük kişiler dahil görünür tam bir insan, en az 90/100 kişi-sayım güveni, doğrulanmış aranan kimlik ve görünür/tanınabilir yüz zorunlu; cinsiyetten kimlik varsayılmaz ve tüm hedeflere aynı eşikler uygulanır; grup, kalabalık, kolaj veya belirsiz sonuçlar puanlanmaz ve seçilemez
- Gemini görsel analizi: filtreyi geçen fotoğraflarda alaka, netlik, çözünürlük, ışık, renk, kompozisyon, kadraj ve edit uygunluğu için ağırlıklı 100 puanlık estetik değerlendirme
- Doğrulanmış, benzersiz ve en az 45 puanlı görseller arasından puanı en yüksek 20 veya 100 görseli otomatik seçme
- Kaynak sayfası, kaynak adı ve mevcutsa çözünürlük bilgileri
- Arama oturumundaki fotoğraf kimliklerini sunucuda yeniden kontrol ederek, AI doğrulaması yapılmış olsun veya olmasın seçilen görselleri güvenli URL ve dosya boyutu kontrolleriyle ZIP olarak indirme
- Arama geçmişi, manuel seçim, tümünü seçme ve tekrar arama

Analiz sonuçları Gemini tarafından üretilir; görsel indirilemez veya AI yanıtı doğrulanamazsa sonuç puan uydurmak yerine analiz hatası olarak gösterilir. ZIP oluşturulurken erişilemeyen görseller atlanır ve manifestte belirtilir. Google Görseller sonucu kullanım lisansı anlamına gelmez; her görselin telif ve kullanım koşullarını kaynak sayfasında kontrol edin.

## AI Studio

AI Studio araçları ücretli bir AI servisi kullanmadan, görüntü işleme için Sharp veya video için tarayıcı API’leri kullanır. Mevcut görsel arama, Gemini analiz ve ZIP indirme akışlarından bağımsızdır. Çalışan araçlar: arka plan renk anahtarlama, Lanczos büyütme, keskinleştirme, maskeli alanı komşu piksellerle doldurma, düz renk arka plan değiştirme, dikkat odaklı kırpma, renk/ışık ayarı, metinli thumbnail, glow, toplu ZIP düzenleme ve tarayıcıda 5 saniyelik pan/zoom WebM.

- `POST /api/studio/uploads`: JPEG, PNG, WebP veya AVIF görselini `application/octet-stream` gövdesiyle yükler. Üst sınır dosya başına 15 MB, 20 megapiksel ve kenar başına 10.000 pikseldir. Görsel türü dosya adı veya istemci MIME değerinden değil, görsel çözümlemesinden belirlenir.
- Yanıtın `previewUrl` değeri görseli özel önbelleksiz yanıtla gösterir; `DELETE /api/studio/uploads/:id` yüklemeyi erken siler.
- `POST /api/studio/uploads/:id/tools/:tool/preview` ve `/export`: Studio arayüzündeki ayrı araçları çalıştırır. Her istekte JSON `{ "options": { ... } }` gönderilir. Örnek araç kimlikleri: `background-removal`, `image-enhancement`, `sharpening`, `object-removal`, `background-replacement`, `smart-crop`, `color-light-correction`, `thumbnail` ve `glow-effects`.
- Renk/ışık ayarları parlaklık ve kontrast `-50..50`, doygunluk ve sıcaklık `-100..100`, gamma `1..3`, keskinlik `0..100` alır. `POST /api/studio/batch-export` en fazla 5 aynı sahibin yükleme kimliğiyle PNG/JPG/WebP ZIP'i üretir; toplam giriş 25 MP, çıktı 75 MB ile sınırlıdır.
- Tüm görsel işlemleri geçici kaynağı sadece okur; orijinal yükleme üzerine yazılmaz. Video özelliği sunucu API’si kullanmaz; tarayıcı `MediaRecorder` destekliyorsa 5 saniyelik pan/zoom WebM üretir, aksi durumda hata gösterir.
- Arka plan kaldırma yalnızca kenar renginden benzer pikselleri saydamlaştırır; genel sahnelerde kişi segmentasyonu değildir. Nesne kaldırma AI inpainting değildir; maskeli alanı komşu piksellerle dolduran basit bir işlemdir. Kalite artırma AI değildir; Lanczos yeniden örnekleme ve keskinleştirme uygular. Fotoğraftan video da AI değildir.
- Yüklemeler uygulama dışında, işletim sisteminin geçici dizininde tutulur ve bir saat sonra temizlenir. Sunucu yeniden başlatıldığında yükleme kimlikleri geçersiz olur; Render üzerinde bu alan kalıcı depolama değildir.
- Yükleme kimlikleri tahmin edilmesi güç erişim belirteçleridir; mevcut uygulamada kullanıcı hesabı/kimlik doğrulama altyapısı yoktur. Bunları paylaşmayın.
- Ücretli sağlayıcı/API çağrısı eklenmemiştir; hiçbir araç AI model sonucu iddia etmez.
- İş ve tahmini kullanım kayıtları şu aşamada süreç belleğindedir; bütçe koruması çok örnekli dağıtımlarda ortak/kalıcı bir defter değildir. Uzun süreli veya çok örnekli ücretli üretim öncesinde kalıcı kuyruk, kullanım defteri ve nesne depolama yapılandırması gerekir.
