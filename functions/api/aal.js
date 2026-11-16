// Two-step verification check for admin routes.
// Call it only AFTER Supabase has accepted the token (/auth/v1/user), so its claims can be trusted.
// Supabase sets aal = "aal2" once the user has entered a 6-digit code from their authenticator app.
export function isAal2(request) {
  try {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64)).aal === "aal2";
  } catch {
    return false;
  }
}
export const MFA_ERROR = "Two-step verification required. Reload the admin panel and enter the 6-digit code from your authenticator app.";
