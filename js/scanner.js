/* StreakFit — barcode scanner bridge (placeholder).
 *
 * This is intentionally a stub. To enable real scanning later, drop in a client-side
 * reader such as html5-qrcode (https://github.com/mebjas/html5-qrcode):
 *
 *   1. Add <script src="https://unpkg.com/html5-qrcode"></script> to index.html.
 *   2. Replace the body below with an Html5Qrcode instance targeting #scanner-view.
 *   3. On a successful decode, look the barcode up (e.g. via Open Food Facts) or map it
 *      to a FOODS / customFoods entry, then call addFoodToToday(matchedFood).
 *
 * Keeping it isolated here means the rest of the app never needs to know how scanning
 * is implemented.
 */
function initBarcodeScanner() {
  console.log("StreakFit: barcode scanner not yet connected (placeholder).");
  alert(
    "📷 Barcode scanning isn't wired up yet.\n\n" +
      "For now, use search or Quick Add. A client-side reader (e.g. html5-qrcode) " +
      "can be hooked into initBarcodeScanner() in js/scanner.js later."
  );
  // Hook point for a future reader library:
  // const reader = new Html5Qrcode("scanner-view");
  // reader.start({ facingMode: "environment" }, { fps: 10 }, onScanSuccess);
}
