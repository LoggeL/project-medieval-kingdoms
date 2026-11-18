/**
 * Träger (Befund der Gesamtprüfung, ADR 0020): Tagelöhner tragen alle Waren, bauen und reparieren. Werden alle zu
 * Soldaten oder Werkstattarbeitern, steht die Wirtschaft für immer still (keine Baustelle, kein Wohnhaus, kein Zuzug).
 */
export const CARRIERS = {
  /** So viele Tagelöhner bleiben immer Träger: Die Kaserne bildet keinen von ihnen aus, und Hunger vertreibt sie nicht. */
  reserve: 2,
  /**
   * Notzuzug: Sind weniger als `reserve` Träger da, zieht trotz vollem Wohnraum und Hunger im normalen Abstand
   * (TUNING.immigrantSeconds) ein Tagelöhner zu, bis wieder `reserve` Träger da sind.
   */
  emergency: true,
};
