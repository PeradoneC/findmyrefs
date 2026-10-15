// Sites without an accessible API for this app. Instead of scraping them we open a
// prefilled search on the site itself, in the user's browser.

export type WebSearchSite = { id: string; name: string; buildUrl: (query: string) => string };

const enc = encodeURIComponent;

export const WEB_SEARCH_SITES: WebSearchSite[] = [
  {
    id: "pinterest",
    name: "Pinterest",
    buildUrl: (q) => `https://www.pinterest.com/search/pins/?q=${enc(q)}`,
  },
  {
    id: "artstation",
    name: "ArtStation",
    buildUrl: (q) => `https://www.artstation.com/search?sort_by=relevance&query=${enc(q)}`,
  },
  {
    id: "google",
    name: "Google Images",
    buildUrl: (q) => `https://www.google.com/search?tbm=isch&q=${enc(q)}`,
  },
  {
    id: "behance",
    name: "Behance",
    buildUrl: (q) => `https://www.behance.net/search/projects?search=${enc(q)}`,
  },
  {
    id: "deviantart",
    name: "DeviantArt",
    buildUrl: (q) => `https://www.deviantart.com/search?q=${enc(q)}`,
  },
  { id: "x", name: "X (media)", buildUrl: (q) => `https://x.com/search?q=${enc(q)}&f=media` },
];
