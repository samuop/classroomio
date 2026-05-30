import { FromData } from '../types';
import { EMAIL_FROM } from '../constants';

// Accepts both `"Name" <a@b.com>` and `Name <a@b.com>` (quotes optional), as
// well as a bare `a@b.com`. Returns the display name and the clean email.
export function extractNameAndEmail(str: string): FromData | undefined {
  // Quoted or unquoted display name followed by <email>.
  const withName = str.match(/^\s*"?(.*?)"?\s*<\s*([^<>@\s]+@[^<>\s]+)\s*>\s*$/);
  if (withName) {
    return { name: withName[1].trim(), email: withName[2].trim() };
  }

  // Bare email address with no display name.
  const bareEmail = str.match(/<?\s*([^<>@\s]+@[^<>\s]+)\s*>?/);
  if (bareEmail) {
    return { name: '', email: bareEmail[1].trim() };
  }

  // Unparseable — return the raw string for both fields.
  return { name: str, email: str };
}

/**
 * Strips ClassroomIO branding that callers append to the sender display name
 * (e.g. "Acme (via ClassroomIO.com)", "Acme - ClassroomIO", or a bare
 * "ClassroomIO"). Centralized here so every email sender is clean without
 * touching each call site. Falls back to the configured brand name.
 */
function stripClassroomioBranding(name: string): string {
  let cleaned = name
    .replace(/\s*\(via ClassroomIO\.com\)\s*/gi, '')
    .replace(/\s*[-–]\s*ClassroomIO\s*/gi, '')
    .trim();

  // If the name WAS just "ClassroomIO" (or empty after stripping), use the brand.
  if (!cleaned || /^classroomio$/i.test(cleaned)) {
    cleaned = process.env.EMAIL_BRAND_NAME?.trim() || 'Egea Consultoria';
  }

  return cleaned;
}

export function buildEmailFromName(name?: string): string {
  if (!name) {
    return EMAIL_FROM;
  }

  const fromData = extractNameAndEmail(EMAIL_FROM);
  if (!fromData?.email) {
    return EMAIL_FROM;
  }

  return `"${stripClassroomioBranding(name)}" <${fromData.email}>`;
}
