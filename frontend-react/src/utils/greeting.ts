/**
 * Time-of-day greeting from the visitor's local clock (not the simulation clock).
 *
 *   05:00 – 11:59  Good morning
 *   12:00 – 16:59  Good afternoon
 *   17:00 – 20:59  Good evening
 *   21:00 – 04:59  Good night
 */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}
