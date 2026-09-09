export function isSafeInternalHref(href: string): boolean {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes(":") &&
    /^\/[a-zA-Z0-9/_-]*$/.test(href)
  );
}
