/* StreakFit — barcode scanner.
 * Uses html5-qrcode (loaded from CDN in index.html) for camera-based barcode reading,
 * then looks the product up on Open Food Facts (free, huge global DB incl. many Gulf
 * items) and prefills the Quick Add form. Needs camera permission + internet for lookup;
 * the rest of the app works offline.
 */
let _html5qr = null;

function initBarcodeScanner() {
  if (typeof Html5Qrcode === "undefined") {
    alert("Scanner library didn't load (are you offline?). Use search or Quick Add for now.");
    return;
  }
  if (!navigator.mediaDevices || !window.isSecureContext) {
    alert("Camera scanning needs HTTPS (it works on the live site). On the local file, use search or Quick Add.");
    return;
  }
  openScannerModal();
}

function openScannerModal() {
  closeScannerModal();
  const modal = document.createElement("div");
  modal.id = "scan-modal";
  modal.innerHTML = `
    <div class="scan-card">
      <button class="ex-close" aria-label="close"><i class="fa-solid fa-xmark"></i></button>
      <h3><i class="fa-solid fa-barcode"></i> Scan a barcode</h3>
      <div id="reader" class="reader"></div>
      <p id="scan-status" class="muted small">Point your camera at a product barcode…</p>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".ex-close")) closeScannerModal();
  });

  // Restrict to product (UPC/EAN) barcodes — not QR codes.
  let constructorCfg = { verbose: false };
  if (typeof Html5QrcodeSupportedFormats !== "undefined") {
    constructorCfg.formatsToSupport = [
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
    ];
  }
  _html5qr = new Html5Qrcode("reader", constructorCfg);
  _html5qr
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 150 }, aspectRatio: 1.7 },
      (decodedText) => onBarcode(decodedText),
      () => {} // per-frame decode failures are normal; ignore
    )
    .catch((err) => {
      setScanStatus("Couldn't start the camera: " + err);
    });
}

function setScanStatus(msg) {
  const el = document.getElementById("scan-status");
  if (el) el.textContent = msg;
}

async function onBarcode(code) {
  // Stop scanning immediately so we don't fire repeatedly.
  if (_html5qr) {
    try { await _html5qr.stop(); } catch (e) {}
  }
  setScanStatus(`Looking up ${code}…`);
  try {
    const food = await lookupBarcode(code);
    closeScannerModal();
    App.switchTab("log");
    if (window.prefillQuickAdd) prefillQuickAdd(food);
  } catch (err) {
    setScanStatus(err.message + " — try Quick Add instead.");
  }
}

async function lookupBarcode(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Lookup failed");
  const data = await res.json();
  if (data.status !== 1 || !data.product) throw new Error("Product not found");
  const p = data.product;
  const n = p.nutriments || {};
  const name = [p.brands, p.product_name].filter(Boolean).join(" ").trim() || `Item ${code}`;
  return {
    name,
    kcal: Math.round(n["energy-kcal_100g"] || 0),
    protein: +(n.proteins_100g || 0).toFixed(1),
    carbs: +(n.carbohydrates_100g || 0).toFixed(1),
    fats: +(n.fat_100g || 0).toFixed(1),
    sugar: +(n.sugars_100g || 0).toFixed(1),
    serving: p.serving_size || "per 100 g",
  };
}

function closeScannerModal() {
  if (_html5qr) {
    try { _html5qr.stop().catch(() => {}); } catch (e) {}
    _html5qr = null;
  }
  const m = document.getElementById("scan-modal");
  if (m) m.remove();
}
