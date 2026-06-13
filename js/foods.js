/* StreakFit — food database, PER 100 g basis (so any gram amount auto-scales).
 * Shipped as a JS const (no fetch → works from file://).
 * Each item: { name, kcal, protein, carbs, fats, sugar, fiber, sodium, serving }
 *   - macros are PER 100 g (sodium in mg per 100 g)
 *   - serving = { label, g } : a sensible default portion in grams
 * Ingredient-focused for homemade cooking; values are sensible estimates.
 */
const FOODS = [
  // ---------- Proteins (cooked unless noted) ----------
  { name: "Chicken Breast (cooked)", kcal: 165, protein: 31, carbs: 0, fats: 3.6, sugar: 0, fiber: 0, sodium: 74, serving: { label: "1 fillet", g: 120 } },
  { name: "Chicken Thigh (cooked)", kcal: 209, protein: 26, carbs: 0, fats: 11, sugar: 0, fiber: 0, sodium: 86, serving: { label: "1 thigh", g: 90 } },
  { name: "Whole Roast Chicken", kcal: 239, protein: 27, carbs: 0, fats: 14, sugar: 0, fiber: 0, sodium: 82, serving: { label: "1 portion", g: 150 } },
  { name: "Beef Mince (lean, cooked)", kcal: 217, protein: 26, carbs: 0, fats: 12, sugar: 0, fiber: 0, sodium: 72, serving: { label: "1 portion", g: 125 } },
  { name: "Beef Steak (cooked)", kcal: 271, protein: 25, carbs: 0, fats: 19, sugar: 0, fiber: 0, sodium: 55, serving: { label: "1 steak", g: 150 } },
  { name: "Lamb (cooked)", kcal: 294, protein: 25, carbs: 0, fats: 21, sugar: 0, fiber: 0, sodium: 72, serving: { label: "1 portion", g: 120 } },
  { name: "Lamb Mince (cooked)", kcal: 282, protein: 17, carbs: 0, fats: 23, sugar: 0, fiber: 0, sodium: 75, serving: { label: "1 portion", g: 120 } },
  { name: "Turkey Breast (cooked)", kcal: 135, protein: 30, carbs: 0, fats: 1, sugar: 0, fiber: 0, sodium: 60, serving: { label: "1 portion", g: 120 } },
  { name: "Hammour / White Fish", kcal: 105, protein: 23, carbs: 0, fats: 1.2, sugar: 0, fiber: 0, sodium: 90, serving: { label: "1 fillet", g: 150 } },
  { name: "Salmon (cooked)", kcal: 208, protein: 20, carbs: 0, fats: 13, sugar: 0, fiber: 0, sodium: 59, serving: { label: "1 fillet", g: 130 } },
  { name: "Kingfish (cooked)", kcal: 130, protein: 24, carbs: 0, fats: 3.5, sugar: 0, fiber: 0, sodium: 80, serving: { label: "1 steak", g: 150 } },
  { name: "Canned Tuna (in water)", kcal: 116, protein: 26, carbs: 0, fats: 1, sugar: 0, fiber: 0, sodium: 320, serving: { label: "1 can drained", g: 120 } },
  { name: "Canned Tuna (in oil)", kcal: 190, protein: 25, carbs: 0, fats: 10, sugar: 0, fiber: 0, sodium: 340, serving: { label: "1 can drained", g: 120 } },
  { name: "Shrimp (cooked)", kcal: 99, protein: 24, carbs: 0.2, fats: 0.3, sugar: 0, fiber: 0, sodium: 220, serving: { label: "1 portion", g: 100 } },
  { name: "Sardines (canned)", kcal: 208, protein: 25, carbs: 0, fats: 11.5, sugar: 0, fiber: 0, sodium: 400, serving: { label: "1 can", g: 90 } },
  { name: "Egg (whole)", kcal: 143, protein: 13, carbs: 1.1, fats: 9.5, sugar: 1.1, fiber: 0, sodium: 142, serving: { label: "1 egg", g: 50 } },
  { name: "Egg White", kcal: 52, protein: 11, carbs: 0.7, fats: 0.2, sugar: 0.7, fiber: 0, sodium: 166, serving: { label: "1 white", g: 33 } },
  { name: "Tofu (firm)", kcal: 144, protein: 17, carbs: 3, fats: 9, sugar: 0.6, fiber: 2, sodium: 14, serving: { label: "1 block", g: 120 } },
  { name: "Whey Protein Powder", kcal: 400, protein: 80, carbs: 8, fats: 7, sugar: 5, fiber: 1, sodium: 300, serving: { label: "1 scoop", g: 30 } },
  { name: "Chicken Shawarma Meat", kcal: 215, protein: 24, carbs: 2, fats: 12, sugar: 0.5, fiber: 0, sodium: 500, serving: { label: "1 portion", g: 120 } },

  // ---------- Dairy (per 100 g / ml) ----------
  { name: "Baladna Full Fat Milk", kcal: 61, protein: 3.2, carbs: 4.8, fats: 3.3, sugar: 4.8, fiber: 0, sodium: 43, serving: { label: "1 cup", g: 240 } },
  { name: "Baladna Low Fat Milk", kcal: 46, protein: 3.4, carbs: 4.9, fats: 1.5, sugar: 4.9, fiber: 0, sodium: 44, serving: { label: "1 cup", g: 240 } },
  { name: "Baladna Skimmed Milk", kcal: 35, protein: 3.5, carbs: 5, fats: 0.3, sugar: 5, fiber: 0, sodium: 42, serving: { label: "1 cup", g: 240 } },
  { name: "Baladna Laban", kcal: 40, protein: 3, carbs: 4.5, fats: 1.2, sugar: 4.5, fiber: 0, sodium: 40, serving: { label: "1 cup", g: 240 } },
  { name: "Greek Yogurt (plain)", kcal: 87, protein: 7.3, carbs: 4, fats: 4.7, sugar: 4, fiber: 0, sodium: 36, serving: { label: "1 pot", g: 150 } },
  { name: "Greek Yogurt (low fat)", kcal: 59, protein: 10, carbs: 3.6, fats: 0.4, sugar: 3.6, fiber: 0, sodium: 36, serving: { label: "1 pot", g: 150 } },
  { name: "Labneh", kcal: 150, protein: 7.7, carbs: 6, fats: 11, sugar: 6, fiber: 0, sodium: 150, serving: { label: "2 tbsp", g: 50 } },
  { name: "Feta Cheese", kcal: 264, protein: 14, carbs: 4, fats: 21, sugar: 4, fiber: 0, sodium: 917, serving: { label: "1 slice", g: 30 } },
  { name: "Halloumi", kcal: 321, protein: 21, carbs: 2.6, fats: 26, sugar: 1, fiber: 0, sodium: 1350, serving: { label: "2 slices", g: 60 } },
  { name: "Mozzarella", kcal: 280, protein: 21, carbs: 2.3, fats: 21, sugar: 1, fiber: 0, sodium: 627, serving: { label: "1 portion", g: 30 } },
  { name: "Cheddar Cheese", kcal: 402, protein: 25, carbs: 1.3, fats: 33, sugar: 0.5, fiber: 0, sodium: 621, serving: { label: "1 slice", g: 30 } },
  { name: "Cream Cheese", kcal: 342, protein: 6, carbs: 4, fats: 34, sugar: 3, fiber: 0, sodium: 321, serving: { label: "1 tbsp", g: 30 } },
  { name: "Butter", kcal: 717, protein: 0.9, carbs: 0.1, fats: 81, sugar: 0.1, fiber: 0, sodium: 11, serving: { label: "1 tbsp", g: 14 } },
  { name: "Ghee", kcal: 900, protein: 0, carbs: 0, fats: 100, sugar: 0, fiber: 0, sodium: 0, serving: { label: "1 tbsp", g: 13 } },

  // ---------- Grains / carbs (cooked unless noted) ----------
  { name: "White Rice (cooked)", kcal: 130, protein: 2.7, carbs: 28, fats: 0.3, sugar: 0.1, fiber: 0.4, sodium: 1, serving: { label: "1 cup", g: 158 } },
  { name: "Basmati Rice (cooked)", kcal: 121, protein: 3, carbs: 25, fats: 0.4, sugar: 0.1, fiber: 0.5, sodium: 1, serving: { label: "1 cup", g: 158 } },
  { name: "Brown Rice (cooked)", kcal: 112, protein: 2.6, carbs: 24, fats: 0.9, sugar: 0.4, fiber: 1.8, sodium: 5, serving: { label: "1 cup", g: 158 } },
  { name: "Pasta (cooked)", kcal: 158, protein: 5.8, carbs: 31, fats: 0.9, sugar: 0.6, fiber: 1.8, sodium: 1, serving: { label: "1 cup", g: 140 } },
  { name: "Oats (dry)", kcal: 389, protein: 17, carbs: 66, fats: 7, sugar: 1, fiber: 11, sodium: 2, serving: { label: "1/2 cup", g: 40 } },
  { name: "Bulgur (cooked)", kcal: 83, protein: 3, carbs: 19, fats: 0.2, sugar: 0.1, fiber: 4.5, sodium: 5, serving: { label: "1 cup", g: 182 } },
  { name: "Quinoa (cooked)", kcal: 120, protein: 4.4, carbs: 21, fats: 1.9, sugar: 0.9, fiber: 2.8, sodium: 7, serving: { label: "1 cup", g: 185 } },
  { name: "Lentils (cooked)", kcal: 116, protein: 9, carbs: 20, fats: 0.4, sugar: 1.8, fiber: 8, sodium: 2, serving: { label: "1 cup", g: 198 } },
  { name: "Chickpeas (cooked)", kcal: 164, protein: 9, carbs: 27, fats: 2.6, sugar: 5, fiber: 8, sodium: 24, serving: { label: "1 cup", g: 164 } },
  { name: "White Beans (cooked)", kcal: 139, protein: 9.7, carbs: 25, fats: 0.5, sugar: 0.3, fiber: 6.3, sodium: 6, serving: { label: "1 cup", g: 179 } },
  { name: "Foul / Fava Beans (cooked)", kcal: 110, protein: 7.6, carbs: 20, fats: 0.4, sugar: 0, fiber: 5.4, sodium: 8, serving: { label: "1 cup", g: 170 } },
  { name: "Arabic Bread (Khubz)", kcal: 275, protein: 9, carbs: 55, fats: 1.5, sugar: 2, fiber: 2.5, sodium: 500, serving: { label: "1 loaf", g: 60 } },
  { name: "Samoon Bread", kcal: 290, protein: 9, carbs: 55, fats: 4, sugar: 3, fiber: 2.5, sodium: 480, serving: { label: "1 piece", g: 65 } },
  { name: "White Bread", kcal: 265, protein: 9, carbs: 49, fats: 3.2, sugar: 5, fiber: 2.7, sodium: 491, serving: { label: "1 slice", g: 28 } },
  { name: "Brown Bread", kcal: 247, protein: 13, carbs: 41, fats: 3.4, sugar: 4, fiber: 7, sodium: 455, serving: { label: "1 slice", g: 28 } },
  { name: "Potato (boiled)", kcal: 87, protein: 1.9, carbs: 20, fats: 0.1, sugar: 0.9, fiber: 1.8, sodium: 4, serving: { label: "1 medium", g: 150 } },
  { name: "Sweet Potato (baked)", kcal: 90, protein: 2, carbs: 21, fats: 0.1, sugar: 6.5, fiber: 3.3, sodium: 36, serving: { label: "1 medium", g: 130 } },
  { name: "French Fries", kcal: 312, protein: 3.4, carbs: 41, fats: 15, sugar: 0.3, fiber: 3.8, sodium: 210, serving: { label: "1 medium", g: 117 } },
  { name: "Corn (cooked)", kcal: 96, protein: 3.4, carbs: 21, fats: 1.5, sugar: 4.5, fiber: 2.4, sodium: 15, serving: { label: "1 ear", g: 90 } },
  { name: "Cornflakes", kcal: 357, protein: 7, carbs: 84, fats: 0.9, sugar: 8, fiber: 3, sodium: 729, serving: { label: "1 bowl", g: 30 } },

  // ---------- Fats / nuts / spreads ----------
  { name: "Olive Oil", kcal: 884, protein: 0, carbs: 0, fats: 100, sugar: 0, fiber: 0, sodium: 2, serving: { label: "1 tbsp", g: 14 } },
  { name: "Vegetable Oil", kcal: 884, protein: 0, carbs: 0, fats: 100, sugar: 0, fiber: 0, sodium: 0, serving: { label: "1 tbsp", g: 14 } },
  { name: "Almonds", kcal: 579, protein: 21, carbs: 22, fats: 50, sugar: 4, fiber: 12, sodium: 1, serving: { label: "small handful", g: 28 } },
  { name: "Peanuts", kcal: 567, protein: 26, carbs: 16, fats: 49, sugar: 4, fiber: 8, sodium: 18, serving: { label: "small handful", g: 28 } },
  { name: "Cashews", kcal: 553, protein: 18, carbs: 30, fats: 44, sugar: 6, fiber: 3, sodium: 12, serving: { label: "small handful", g: 28 } },
  { name: "Pistachios", kcal: 560, protein: 20, carbs: 28, fats: 45, sugar: 8, fiber: 10, sodium: 1, serving: { label: "small handful", g: 28 } },
  { name: "Walnuts", kcal: 654, protein: 15, carbs: 14, fats: 65, sugar: 2.6, fiber: 7, sodium: 2, serving: { label: "small handful", g: 28 } },
  { name: "Mixed Nuts", kcal: 607, protein: 20, carbs: 21, fats: 54, sugar: 4, fiber: 7, sodium: 4, serving: { label: "small handful", g: 30 } },
  { name: "Peanut Butter", kcal: 588, protein: 25, carbs: 20, fats: 50, sugar: 9, fiber: 6, sodium: 350, serving: { label: "1 tbsp", g: 16 } },
  { name: "Tahini", kcal: 595, protein: 17, carbs: 21, fats: 54, sugar: 0.5, fiber: 9, sodium: 115, serving: { label: "1 tbsp", g: 15 } },
  { name: "Hummus", kcal: 166, protein: 8, carbs: 14, fats: 10, sugar: 0, fiber: 6, sodium: 379, serving: { label: "2 tbsp", g: 60 } },
  { name: "Moutabal", kcal: 150, protein: 3, carbs: 9, fats: 12, sugar: 3, fiber: 4, sodium: 300, serving: { label: "2 tbsp", g: 60 } },
  { name: "Avocado", kcal: 160, protein: 2, carbs: 9, fats: 15, sugar: 0.7, fiber: 7, sodium: 7, serving: { label: "1/2 fruit", g: 100 } },

  // ---------- Vegetables (raw unless noted) ----------
  { name: "Cucumber", kcal: 15, protein: 0.7, carbs: 3.6, fats: 0.1, sugar: 1.7, fiber: 0.5, sodium: 2, serving: { label: "1 cup", g: 120 } },
  { name: "Tomato", kcal: 18, protein: 0.9, carbs: 3.9, fats: 0.2, sugar: 2.6, fiber: 1.2, sodium: 5, serving: { label: "1 medium", g: 120 } },
  { name: "Lettuce", kcal: 15, protein: 1.4, carbs: 2.9, fats: 0.2, sugar: 0.8, fiber: 1.3, sodium: 28, serving: { label: "1 cup", g: 50 } },
  { name: "Onion", kcal: 40, protein: 1.1, carbs: 9.3, fats: 0.1, sugar: 4.2, fiber: 1.7, sodium: 4, serving: { label: "1 medium", g: 110 } },
  { name: "Carrot", kcal: 41, protein: 0.9, carbs: 10, fats: 0.2, sugar: 4.7, fiber: 2.8, sodium: 69, serving: { label: "1 medium", g: 60 } },
  { name: "Bell Pepper", kcal: 31, protein: 1, carbs: 6, fats: 0.3, sugar: 4.2, fiber: 2.1, sodium: 4, serving: { label: "1 medium", g: 120 } },
  { name: "Spinach (cooked)", kcal: 23, protein: 2.9, carbs: 3.8, fats: 0.4, sugar: 0.4, fiber: 2.4, sodium: 79, serving: { label: "1 cup", g: 180 } },
  { name: "Eggplant (cooked)", kcal: 35, protein: 0.8, carbs: 8.7, fats: 0.2, sugar: 3.2, fiber: 2.5, sodium: 1, serving: { label: "1 cup", g: 99 } },
  { name: "Okra (cooked)", kcal: 33, protein: 1.9, carbs: 7, fats: 0.2, sugar: 1.5, fiber: 3.2, sodium: 7, serving: { label: "1 cup", g: 160 } },
  { name: "Broccoli (cooked)", kcal: 35, protein: 2.4, carbs: 7, fats: 0.4, sugar: 1.4, fiber: 3.3, sodium: 41, serving: { label: "1 cup", g: 156 } },
  { name: "Mixed Vegetables", kcal: 65, protein: 2.6, carbs: 13, fats: 0.4, sugar: 4, fiber: 4, sodium: 50, serving: { label: "1 cup", g: 160 } },

  // ---------- Fruits ----------
  { name: "Banana", kcal: 89, protein: 1.1, carbs: 23, fats: 0.3, sugar: 12, fiber: 2.6, sodium: 1, serving: { label: "1 medium", g: 118 } },
  { name: "Apple", kcal: 52, protein: 0.3, carbs: 14, fats: 0.2, sugar: 10, fiber: 2.4, sodium: 1, serving: { label: "1 medium", g: 182 } },
  { name: "Orange", kcal: 47, protein: 0.9, carbs: 12, fats: 0.1, sugar: 9, fiber: 2.4, sodium: 0, serving: { label: "1 medium", g: 130 } },
  { name: "Medjool Dates", kcal: 277, protein: 1.8, carbs: 75, fats: 0.2, sugar: 66, fiber: 6.7, sodium: 1, serving: { label: "1 date", g: 24 } },
  { name: "Khalas Dates", kcal: 282, protein: 2, carbs: 75, fats: 0.4, sugar: 63, fiber: 8, sodium: 2, serving: { label: "1 date", g: 8 } },
  { name: "Grapes", kcal: 69, protein: 0.7, carbs: 18, fats: 0.2, sugar: 16, fiber: 0.9, sodium: 2, serving: { label: "1 cup", g: 150 } },
  { name: "Watermelon", kcal: 30, protein: 0.6, carbs: 8, fats: 0.2, sugar: 6, fiber: 0.4, sodium: 1, serving: { label: "1 cup", g: 152 } },
  { name: "Mango", kcal: 60, protein: 0.8, carbs: 15, fats: 0.4, sugar: 14, fiber: 1.6, sodium: 1, serving: { label: "1 cup", g: 165 } },
  { name: "Strawberries", kcal: 32, protein: 0.7, carbs: 8, fats: 0.3, sugar: 5, fiber: 2, sodium: 1, serving: { label: "1 cup", g: 152 } },
  { name: "Pomegranate", kcal: 83, protein: 1.7, carbs: 19, fats: 1.2, sugar: 14, fiber: 4, sodium: 3, serving: { label: "1/2 fruit", g: 87 } },

  // ---------- Prepared / local dishes (per 100 g estimate) ----------
  { name: "Chicken Biryani", kcal: 180, protein: 8, carbs: 22, fats: 7, sugar: 1.2, fiber: 1, sodium: 400, serving: { label: "1 plate", g: 350 } },
  { name: "Kabsa with Chicken", kcal: 200, protein: 9, carbs: 23, fats: 8, sugar: 1.2, fiber: 1, sodium: 420, serving: { label: "1 plate", g: 350 } },
  { name: "Mutton Machboos", kcal: 210, protein: 10, carbs: 21, fats: 10, sugar: 1.2, fiber: 1, sodium: 430, serving: { label: "1 plate", g: 350 } },
  { name: "Falafel", kcal: 333, protein: 13, carbs: 32, fats: 18, sugar: 1, fiber: 5, sodium: 294, serving: { label: "1 piece", g: 17 } },
  { name: "Zaatar Manakish", kcal: 300, protein: 7, carbs: 38, fats: 13, sugar: 2, fiber: 4, sodium: 500, serving: { label: "1 piece", g: 110 } },
  { name: "Tabbouleh", kcal: 120, protein: 2.5, carbs: 12, fats: 7, sugar: 2, fiber: 3, sodium: 240, serving: { label: "1 cup", g: 130 } },

  // ---------- Sweets ----------
  { name: "Sugar (white)", kcal: 387, protein: 0, carbs: 100, fats: 0, sugar: 100, fiber: 0, sodium: 1, serving: { label: "1 tbsp", g: 12 } },
  { name: "Honey", kcal: 304, protein: 0.3, carbs: 82, fats: 0, sugar: 82, fiber: 0.2, sodium: 4, serving: { label: "1 tbsp", g: 21 } },
  { name: "Date Syrup (Dibs)", kcal: 300, protein: 0.5, carbs: 73, fats: 0, sugar: 65, fiber: 0, sodium: 5, serving: { label: "1 tbsp", g: 20 } },
  { name: "Milk Chocolate", kcal: 535, protein: 7.6, carbs: 59, fats: 30, sugar: 52, fiber: 3.4, sodium: 79, serving: { label: "1 bar", g: 45 } },
  { name: "Dark Chocolate", kcal: 546, protein: 4.9, carbs: 61, fats: 31, sugar: 48, fiber: 7, sodium: 24, serving: { label: "30 g", g: 30 } },
  { name: "Kunafa", kcal: 380, protein: 6, carbs: 49, fats: 18, sugar: 30, fiber: 1, sodium: 200, serving: { label: "1 slice", g: 100 } },
  { name: "Vanilla Ice Cream", kcal: 207, protein: 3.5, carbs: 24, fats: 11, sugar: 21, fiber: 0.7, sodium: 80, serving: { label: "1 scoop", g: 66 } },

  // ---------- Beverages (per 100 ml) ----------
  { name: "Orange Juice", kcal: 45, protein: 0.7, carbs: 10, fats: 0.2, sugar: 8, fiber: 0.2, sodium: 1, serving: { label: "1 cup", g: 240 } },
  { name: "Karak Chai", kcal: 60, protein: 1.5, carbs: 10, fats: 1.8, sugar: 9, fiber: 0, sodium: 20, serving: { label: "1 cup", g: 120 } },
  { name: "Laban Up", kcal: 55, protein: 2, carbs: 7, fats: 2, sugar: 6, fiber: 0, sodium: 30, serving: { label: "1 cup", g: 240 } },
  { name: "Pepsi", kcal: 41, protein: 0, carbs: 11, fats: 0, sugar: 11, fiber: 0, sodium: 4, serving: { label: "1 can", g: 330 } },
  { name: "Whey Shake (water)", kcal: 50, protein: 10, carbs: 1, fats: 0.6, sugar: 1, fiber: 0, sodium: 40, serving: { label: "1 glass", g: 300 } },
];
