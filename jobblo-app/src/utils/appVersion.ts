/**
 * "1.0.0 (12)": the store version and the build number, as shown under Min Jobblo and
 * Innstillinger. The build number changes with every EAS build (autoIncrement), so a tester
 * can tell exactly which build is installed; it is left out where there is none (web).
 */
export function appVersionLabel(version?: string | null, build?: string | null): string {
  if (!version) return '';
  return build ? `${version} (${build})` : version;
}
