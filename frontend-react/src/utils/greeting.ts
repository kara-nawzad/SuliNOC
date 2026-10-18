/** Time-of-day greeting from the visitor's local clock (not the simulation clock).
 * Morning 05:00–11:59, afternoon 12:00–17:59, evening 18:00–21:59, night otherwise. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Good night";
}
