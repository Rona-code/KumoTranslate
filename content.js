// content.js

let isScanning = false;

browser.runtime.onMessage.addListener((request) => {
  if (request.action === "toggleScan") {
    isScanning = request.enabled;
    if (isScanning) {
      scanAndTranslatePages();
    } else {
      removeOverlays();
    }
  }
});

function removeOverlays() {
  document.querySelectorAll(".kumo-overlay-container").forEach((el) => el.remove());
}

async function scanAndTranslatePages() {
  // On prend les images qui ont la taille d'une page (hauteur minimale 500px)
  const images = Array.from(document.querySelectorAll("img")).filter(
    (img) => img.clientHeight >= 500 && img.clientWidth >= 300
  );

  console.log(`[KumoTranslate] ${images.length} pages de manga ciblées.`);

  for (const img of images) {
    if (!isScanning) break;
    await processSingleImage(img);
  }
}

// Remplace uniquement cette fonction dans content.js

async function processSingleImage(imgElement) {
  try {
    // 1. Conversion directe de l'image déjà affichée en Base64
    const dataUrl = getBase64FromImage(imgElement);
    if (!dataUrl) {
      console.log("[KumoTranslate] Impossible de lire l'image depuis le DOM.");
      return;
    }

    console.log("[KumoTranslate] Image convertie, envoi à l'OCR...");

    // 2. Envoi direct des données à Tesseract dans le background
    const ocrResponse = await browser.runtime.sendMessage({
      action: "runOCR",
      dataUrl: dataUrl
    });

    if (!ocrResponse || !ocrResponse.results || ocrResponse.results.length === 0) {
      console.log("[KumoTranslate] Aucun texte trouvé.");
      return;
    }

    // 3. Insertion du conteneur d'overlays
    let wrapper = imgElement.previousElementSibling;
    if (!wrapper || !wrapper.classList.contains("kumo-overlay-container")) {
      wrapper = document.createElement("div");
      wrapper.className = "kumo-overlay-container";
      Object.assign(wrapper.style, {
        position: "absolute",
        top: `${imgElement.offsetTop}px`,
        left: `${imgElement.offsetLeft}px`,
        width: `${imgElement.clientWidth}px`,
        height: `${imgElement.clientHeight}px`,
        pointerEvents: "none",
        zIndex: "999"
      });
      imgElement.parentNode.insertBefore(wrapper, imgElement);
    }

    // 4. Traduction et affichage
    for (const item of ocrResponse.results) {
      const translationResponse = await browser.runtime.sendMessage({
        action: "translateText",
        text: item.text
      });

      if (translationResponse && translationResponse.translatedText) {
        createBubbleOverlay(wrapper, item.box, translationResponse.translatedText);
      }
    }
  } catch (err) {
    console.error("[KumoTranslate] Erreur image :", err);
  }
}

// Fonction utilitaire pour extraire le Base64 directement depuis le DOM
function getBase64FromImage(img) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.clientWidth;
    canvas.height = img.naturalHeight || img.clientHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (e) {
    console.error("[KumoTranslate] Erreur Canvas (CORS possible) :", e);
    return null;
  }
}

function createBubbleOverlay(container, box, translatedText) {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    backgroundColor: "#ffffff",
    color: "#000000",
    border: "1px solid #000000",
    borderRadius: "3px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "2px",
    fontSize: "11px",
    fontWeight: "bold",
    lineHeight: "1.1",
    boxSizing: "border-box"
  });

  overlay.innerText = translatedText;
  container.appendChild(overlay);
}