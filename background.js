// background.js - OCR Manga Ultra-Rapide & Vertical

let worker = null;
let isEnabled = false;

browser.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  isEnabled = !isEnabled;
  
  browser.action.setBadgeText({ text: isEnabled ? "ON" : "" });
  browser.action.setBadgeBackgroundColor({ color: isEnabled ? "#4CAF50" : "#666" });

  try {
    await browser.tabs.sendMessage(tab.id, { action: "toggleScan", enabled: isEnabled });
  } catch (err) {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await browser.tabs.sendMessage(tab.id, { action: "toggleScan", enabled: isEnabled });
  }
});

async function getOCRWorker() {
  if (!worker) {
    console.log("[KumoTranslate] Initialisation Tesseract Manga...");
    worker = await Tesseract.createWorker("jpn_vert+jpn", 1, {
      workerPath: browser.runtime.getURL("lib/worker.min.js"),
      corePath: browser.runtime.getURL("lib/tesseract-core.wasm.js"),
      langPath: browser.runtime.getURL("lang/"),
      gzip: false,
      workerBlobURL: false
    });

    // Configuration Tesseract pour forcer la détection verticale de manga
    await worker.setParameters({
      tessedit_pageseg_mode: "5", // 5 = Vertical text block
    });
  }
  return worker;
}

// Redimensionnement + Contraste binaire (N&B)
async function preprocessMangaImage(dataUrl, maxWidth = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Accentuation du contraste pour isoler le texte noir sur fond blanc
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const v = avg < 140 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
      ctx.putImageData(imgData, 0, 0);

      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataUrl;
  });
}

async function processOCR(rawDataUrl) {
  const ocrWorker = await getOCRWorker();
  const processedDataUrl = await preprocessMangaImage(rawDataUrl, 800);
  
  const recognition = await ocrWorker.recognize(processedDataUrl);
  const blocks = recognition.data.blocks || [];
  const imgW = recognition.data.imageColor?.width || 1;
  const imgH = recognition.data.imageColor?.height || 1;
  
  const results = [];

  for (const block of blocks) {
    const cleanText = block.text.replace(/[\s\r\n]+/g, "").trim();
    if (cleanText.length > 0) {
      console.log(`[Japonais Détecté] : ${cleanText}`);
      const bbox = block.bbox;
      results.push({
        text: cleanText,
        box: {
          x: (bbox.x0 / imgW) * 100,
          y: (bbox.y0 / imgH) * 100,
          w: ((bbox.x1 - bbox.x0) / imgW) * 100,
          h: ((bbox.y1 - bbox.y0) / imgH) * 100
        }
      });
    }
  }

  return results;
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchImage") {
    fetch(request.url)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ dataUrl: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch((err) => sendResponse({ error: err ? err.message : "Erreur Fetch Image" }));
    return true;
  }

  if (request.action === "runOCR") {
    processOCR(request.dataUrl)
      .then((results) => sendResponse({ results }))
      .catch((err) => {
        console.error("[KumoTranslate] Erreur OCR :", err);
        sendResponse({ results: [], error: err ? err.message : "Erreur OCR" });
      });
    return true;
  }

  if (request.action === "translateText") {
    const { text, sourceLang = "ja", targetLang = "fr" } = request;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const translatedText = data[0].map((item) => item[0]).join("");
        sendResponse({ translatedText });
      })
      .catch((err) => sendResponse({ error: err ? err.message : "Erreur Traduction" }));
    return true;
  }
});