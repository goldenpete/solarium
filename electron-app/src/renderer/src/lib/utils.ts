import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFaviconUrl(urlOrDomain: string, size: number = 256): string {
  try {
    let domain = urlOrDomain;
    if (urlOrDomain.startsWith('http')) {
        domain = new URL(urlOrDomain).hostname;
    }
    return `https://www.google.com/s2/favicons?sz=${size}&domain=${domain}`;
  } catch {
    return '';
  }
}
