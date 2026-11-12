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

AI Studio araçları ücretli bir AI servisi kullanmaz; çoğu araç Sharp/OpenCV.js ve tarayıcı API’leriyle çalışır. İsteğe bağlı nesne silme aracı yerel LaMa generatif inpainting modelini de destekler. Studio, görsel arama, Gemini analiz ve ZIP indirme akışlarından bağımsızdır.

- `POST /api/studio/uploads`: JPEG, PNG, WebP veya AVIF görselini `application/octet-stream` gövdesiyle yükler. Üst sınır dosya başına 15 MB, 20 megapiksel ve kenar başına 10.000 pikseldir. Görsel türü dosya adı veya istemci MIME değerinden değil, görsel çözümlemesinden belirlenir.
- Yanıtın `previewUrl` değeri görseli özel önbelleksiz yanıtla gösterir; `DELETE /api/studio/uploads/:id` yüklemeyi erken siler.
- `POST /api/studio/uploads/:id/tools/:tool/preview` ve `/export`: Studio arayüzündeki ayrı araçları çalıştırır. Her istekte JSON `{ "options": { ... } }` gönderilir. Örnek araç kimlikleri: `background-removal`, `image-enhancement`, `sharpening`, `object-removal`, `background-replacement`, `smart-crop`, `color-light-correction`, `thumbnail` ve `glow-effects`.
- Renk/ışık ayarları parlaklık ve kontrast `-50..50`, doygunluk ve sıcaklık `-100..100`, gamma `1..3`, keskinlik `0..100` alır. `POST /api/studio/batch-export` en fazla 5 aynı sahibin yükleme kimliğiyle PNG/JPG/WebP ZIP'i üretir; toplam giriş 25 MP, çıktı 75 MB ile sınırlıdır.
- Tüm görsel işlemleri geçici kaynağı sadece okur; orijinal yükleme üzerine yazılmaz. Video özelliği sunucu API’si kullanmaz; tarayıcı `MediaRecorder` destekliyorsa 5 saniyelik pan/zoom WebM üretir, aksi durumda hata gösterir.
- **AI nesne silme:** LaMa (Large Mask Inpainting) CPU üzerinde yerel Python inference servisiyle çalışır. Yaklaşık 206 MB’lık `big-lama.pt` ağırlığı [Sanster GitHub release’inden](https://github.com/Sanster/models/releases/tag/add_big_lama) indirilir; bu TorchScript dönüşümünün kaynağı [IOPaint LaMa adapter’ında](https://github.com/Sanster/IOPaint/blob/main/iopaint/model/lama.py) aynı release/model sağlama toplamı ile gösterilir. [Özgün LaMa deposu](https://github.com/advimman/lama) Apache-2.0 lisanslıdır ve [Hugging Face model kartı](https://huggingface.co/smartywu/big-lama) aynı Big-LaMa ağırlıklarını Apache-2.0 olarak işaretler. Kurulum dosyası Git’e eklenmez: `npm run setup:lama` Python 3.10–3.12 yerel sanal ortamını kurar, CPU PyTorch ve inference bağımlılıklarını yükler, ardından ağırlığı indirip boyut, sabitlenmiş SHA-256 ve upstream IOPaint MD5 ile doğrular. Model `.models/lama/` altında, bağımlılıklar `.lama-venv/` altında tutulur; ikisi `.gitignore` içindedir. İlk kullanımda model belleğe alınır. Kaynak fotoğraflar Express tarafından yalnızca aynı bilgisayardaki, rastgele portta ve oturum başına Bearer token korumalı Python servisine aktarılır; inference uç noktası loopback (`127.0.0.1`) dışına bağlanmaz ve tarayıcıya model servisi token’ı verilmez.
- Studio API’sindeki `GET /api/studio/lama/status` Python bağımlılık yükleme, model doğrulama/yükleme ve gerçek işlem aşamalarını bildirir. CPU inference’ı FastAPI thread pool’unda çalışır; Python event loop’u bloke etmez. Eşzamanlı LaMa işleri reddedilir. Önizleme 225 saniyede, model çağrısı 210 saniyede zaman aşımına uğrar; istemci iptali backend isteğine aktarılır. Arayüz aşama ve geçen süreyi gösterir, modelin üretmediği yüzde ilerlemesi gösterilmez.
- LaMa motoru kurulamaz/başlatılamazsa işlem kendiliğinden klasik sonuca dönmez. Kullanıcı araç seçicisinden **Telea · Klasik görüntü işleme** seçebilir; kurulum/başlatma hatası açıkça gösterilir. LaMa üretken olduğundan maskeli bölgeyi makul görünen içerikle tamamlayabilir, ancak kaynakta olmayan ayrıntıları geri getirdiği garanti edilmez. Telea, OpenCV.js `5.0.0-release.1` (Apache-2.0) ile çalışır. LaMa önizlemesi CPU süresini ve belleği sınırlamak için en fazla 1,2 MP çalışma kopyasında, dışa aktarma ise en fazla 4 MP’de çalışır; iki yolda da değişiklik orijinal çözünürlüğe uygulanır.
- Ağırlık bütünlüğü: SHA-256 `344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9`; upstream IOPaint LaMa adapter’ındaki MD5 `e3aa4aaa15225a33ec84f9f4bc47e500`. Kurulumda ikisi de doğrulanır; checksum eşleşmezse dosya silinir ve inference başlatılmaz.
- **Arka plan değiştirme:** OpenCV GrabCut klasik, kullanıcı işaretlemeli segmentasyon yapar; ilk maske iç çerçeveden başlar. Fırçayla ana nesne ve arka plan işaretleri eklenebilir, kenarlar yumuşatılıp maske genişletilebilir/daraltılabilir; renk, hazır degrade veya aynı oturumda yüklenen arka plan fotoğrafı seçilebilir. İşlem en fazla 3 MP çalışma çözünürlüğüyle sınırlandırılır. Bu genel amaçlı bir ML/AI segmentasyon modeli değildir; ince saç, benzer renkli nesneler ve karmaşık sahnelerde maske elle düzeltilmelidir.
- Ücretsiz ve açık kaynaklı model araştırmasında U²-NetP/rembg seçeneği (320×320 giriş; model dosyası yaklaşık 4.57 MB; U-2-Net deposu Apache-2.0) değerlendirildi, ancak projeye dahil edilmedi. Daha ağır ONNX çalışma zamanı ve model bağımlılıkları mevcut Node/Render kaynak bütçesinde ayrıca doğrulanmadığı için çalışan bir özellikmiş gibi sunulmuyor. Bria RMBG-2.0 modeli ticari kullanıma uygun olmayan CC BY-NC lisanslı olduğundan tercih edilmedi.
- OpenCV.js npm paketi yaklaşık 14.7 MB açılmış boyuttadır; paket Apache-2.0 lisanslıdır. OpenCV işlemleri sunucuda CPU üzerinde, kuyruklanarak çalışır; GPU veya harici servis gerekmez. LaMa kurulumu yerel masaüstü için isteğe bağlıdır; Render deployment’ında Python sanal ortamı ve model dosyası varsayılan olarak bulunmaz. Render’da LaMa çalıştığı iddia edilmez; model erişilemiyorsa kullanıcı Telea’yı seçebilir. LaMa CPU inference’ı en fazla iki Torch thread’i ve tek eşzamanlı işlemle sınırlandırılmıştır; büyük görsellerde süre boyut ve CPU’ya bağlı olarak uzayabilir.
- Kalite ve entegrasyon testleri yerel sentetik sahneleri, maske işaretlerini, PNG/JPG çıktılarını ve büyük görsel sınırlarını kapsar. İnsan portresi, ince saç, kalabalık, gerçek fotoğraf ve görsel kenar kalitesi bu testlerde doğrulanmış değildir; bu tür sonuçlar için gerçek fotoğraflarla ayrıca görsel değerlendirme gerekir.
- Kalite artırma AI değildir; Lanczos yeniden örnekleme ve keskinleştirme uygular. Fotoğraftan video da AI değildir.
- Yüklemeler uygulama dışında, işletim sisteminin geçici dizininde tutulur ve bir saat sonra temizlenir. Sunucu yeniden başlatıldığında yükleme kimlikleri geçersiz olur; Render üzerinde bu alan kalıcı depolama değildir.
- Yükleme kimlikleri tahmin edilmesi güç erişim belirteçleridir; mevcut uygulamada kullanıcı hesabı/kimlik doğrulama altyapısı yoktur. Bunları paylaşmayın.
- Ücretli sağlayıcı/API çağrısı eklenmemiştir; hiçbir araç AI model sonucu iddia etmez.
- İş ve tahmini kullanım kayıtları şu aşamada süreç belleğindedir; bütçe koruması çok örnekli dağıtımlarda ortak/kalıcı bir defter değildir. Uzun süreli veya çok örnekli ücretli üretim öncesinde kalıcı kuyruk, kullanım defteri ve nesne depolama yapılandırması gerekir.
