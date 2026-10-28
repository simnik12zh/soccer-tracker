import { mealHandler } from "./_lib/meal.js";

// POST {image: base64 JPEG, mediaType} → {meal: {title, items, kcal, protein, kcalLow, kcalHigh, confidence}}.
// Requires Authorization: Bearer <APP_ACCESS_CODE>. The photo is not stored.
export default mealHandler();
