import JSZip from 'jszip';

export interface ParsedChapter {
  title: string;
  textContent: string; // raw text with \n between paragraphs
}

export interface ParsedBookData {
  title: string;
  author: string;
  coverDataUrl: string | null;
  chapters: ParsedChapter[];
}

/**
 * Parse an EPUB file from an ArrayBuffer.
 * 
 * EPUB structure:
 * 1. META-INF/container.xml -> points to content.opf
 * 2. content.opf -> metadata (title, author), manifest (files), spine (reading order), cover
 * 3. Spine items -> XHTML files containing chapter content
 */
export async function parseEpub(
  arrayBuffer: ArrayBuffer,
  onProgress?: (detail: string) => void
): Promise<ParsedBookData> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Step 1: Find content.opf via container.xml
  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new Error('Invalid EPUB: missing META-INF/container.xml');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  
  // Handle namespace — container.xml uses the OCF namespace
  const rootfileEl = containerDoc.querySelector('rootfile') 
    || containerDoc.getElementsByTagName('rootfile')[0];
  const rootfilePath = rootfileEl?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('Invalid EPUB: no rootfile in container.xml');

  // Step 2: Parse content.opf
  const opfXml = await readZipText(zip, rootfilePath);
  if (!opfXml) throw new Error(`Invalid EPUB: missing ${rootfilePath}`);

  const opfDoc = parser.parseFromString(opfXml, 'application/xml');
  const opfDir = rootfilePath.includes('/') 
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1) 
    : '';

  // Extract metadata
  const title = getMetadataText(opfDoc, 'title') || 'Untitled';
  const author = getMetadataText(opfDoc, 'creator') || 'Unknown Author';
  onProgress?.('Metadata extracted');

  // Build manifest map (id -> {href, mediaType})
  const manifest = buildManifest(opfDoc);

  // Extract cover image
  const coverDataUrl = await extractCover(zip, opfDoc, manifest, opfDir);
  onProgress?.('Cover extracted');

  // Get spine items (reading order)
  const spineItemIds = getSpineItemIds(opfDoc);
  if (spineItemIds.length === 0) throw new Error('Invalid EPUB: empty spine');

  // Step 3: Extract chapter content from spine items
  const chapters: ParsedChapter[] = [];
  for (let i = 0; i < spineItemIds.length; i++) {
    const itemId = spineItemIds[i]!;
    const item = manifest.get(itemId);
    if (!item) continue;

    // Only process HTML/XHTML content
    if (!item.mediaType.includes('html') && !item.mediaType.includes('xml')) continue;

    const filePath = resolvePath(opfDir, item.href);
    const htmlContent = await readZipText(zip, filePath);
    if (!htmlContent) continue;

    const textContent = extractTextFromXhtml(htmlContent, parser);
    if (!textContent.trim()) continue;

    // Try to detect chapter title from headings in the XHTML
    const chapterTitle = extractChapterTitle(htmlContent, parser) || `Chapter ${chapters.length + 1}`;

    chapters.push({ title: chapterTitle, textContent });
    onProgress?.(`Extracted chapter ${chapters.length}: ${chapterTitle}`);
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract any chapters from this EPUB');
  }

  return { title, author, coverDataUrl, chapters };
}

// === Helper functions ===

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  // Try exact path first, then try case-insensitive
  let file = zip.file(path);
  if (!file) {
    // Try without leading slash
    file = zip.file(path.replace(/^\//, ''));
  }
  if (!file) {
    // Case-insensitive search
    const lowerPath = path.toLowerCase();
    const matchingFile = Object.keys(zip.files).find(f => f.toLowerCase() === lowerPath);
    if (matchingFile) file = zip.file(matchingFile);
  }
  if (!file) return null;
  return file.async('text');
}

function getMetadataText(opfDoc: Document, tagName: string): string | null {
  // Method 1: Use getElementsByTagNameNS with wildcard namespace to match localName regardless of prefix
  let el = opfDoc.getElementsByTagNameNS('*', tagName)[0] ?? null;
  
  if (!el) {
    // Method 2: Direct getElementsByTagName with 'dc:' prefix
    el = opfDoc.getElementsByTagName(`dc:${tagName}`)[0] ?? null;
  }
  if (!el) {
    // Method 3: Direct getElementsByTagName without prefix
    el = opfDoc.getElementsByTagName(tagName)[0] ?? null;
  }
  
  // Ensure the element is actually inside <metadata> to avoid finding spine items named 'title' if any
  if (el) {
    let parent = el.parentNode;
    let inMetadata = false;
    while (parent) {
      if (parent.nodeName.toLowerCase() === 'metadata') {
        inMetadata = true;
        break;
      }
      parent = parent.parentNode;
    }
    if (inMetadata) {
      return el.textContent?.trim() || null;
    }
  }

  // Fallback: iterate over metadata children explicitly
  const metadataEl = opfDoc.getElementsByTagName('metadata')[0] || opfDoc.getElementsByTagNameNS('*', 'metadata')[0];
  if (metadataEl) {
    for (let i = 0; i < metadataEl.childNodes.length; i++) {
      const child = metadataEl.childNodes[i];
      if (child.nodeType === 1 /* Element */) {
        const elChild = child as Element;
        if (elChild.localName === tagName) {
          return elChild.textContent?.trim() || null;
        }
      }
    }
  }

  return null;
}

interface ManifestItem {
  href: string;
  mediaType: string;
  properties?: string;
}

function buildManifest(opfDoc: Document): Map<string, ManifestItem> {
  const map = new Map<string, ManifestItem>();
  const items = opfDoc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || undefined;
    if (id && href) {
      map.set(id, { href: decodeURIComponent(href), mediaType, properties });
    }
  }
  return map;
}

function getSpineItemIds(opfDoc: Document): string[] {
  const ids: string[] = [];
  const itemrefs = opfDoc.getElementsByTagName('itemref');
  for (let i = 0; i < itemrefs.length; i++) {
    const idref = itemrefs[i]!.getAttribute('idref');
    if (idref) ids.push(idref);
  }
  return ids;
}

async function extractCover(
  zip: JSZip,
  opfDoc: Document,
  manifest: Map<string, ManifestItem>,
  opfDir: string
): Promise<string | null> {
  // Method 1: EPUB3 cover-image property in manifest
  for (const [, item] of manifest) {
    if (item.properties?.includes('cover-image') && item.mediaType.startsWith('image/')) {
      return await readImageAsDataUrl(zip, resolvePath(opfDir, item.href), item.mediaType);
    }
  }

  // Method 2: meta name="cover" in metadata pointing to manifest item
  const metaElements = opfDoc.getElementsByTagName('meta');
  for (let i = 0; i < metaElements.length; i++) {
    const meta = metaElements[i]!;
    if (meta.getAttribute('name') === 'cover') {
      const coverId = meta.getAttribute('content');
      if (coverId) {
        const coverItem = manifest.get(coverId);
        if (coverItem && coverItem.mediaType.startsWith('image/')) {
          return await readImageAsDataUrl(zip, resolvePath(opfDir, coverItem.href), coverItem.mediaType);
        }
      }
    }
  }

  // Method 3: Look for common cover filenames
  for (const [, item] of manifest) {
    if (item.mediaType.startsWith('image/') && 
        (item.href.toLowerCase().includes('cover') || item.href.toLowerCase().includes('frontcover'))) {
      return await readImageAsDataUrl(zip, resolvePath(opfDir, item.href), item.mediaType);
    }
  }

  return null;
}

async function readImageAsDataUrl(zip: JSZip, path: string, mediaType: string): Promise<string | null> {
  const file = zip.file(path) || zip.file(path.replace(/^\//, ''));
  if (!file) return null;
  try {
    const base64 = await file.async('base64');
    return `data:${mediaType};base64,${base64}`;
  } catch {
    return null;
  }
}

function resolvePath(dir: string, href: string): string {
  if (href.startsWith('/')) return href.substring(1);
  // Handle relative paths like ../images/cover.jpg
  const parts = (dir + href).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  return resolved.join('/');
}

function extractTextFromXhtml(htmlContent: string, parser: DOMParser): string {
  // Try parsing as XHTML first, fall back to HTML
  let doc: Document;
  try {
    doc = parser.parseFromString(htmlContent, 'application/xhtml+xml');
    // Check for parser errors
    if (doc.querySelector('parsererror')) {
      doc = parser.parseFromString(htmlContent, 'text/html');
    }
  } catch {
    doc = parser.parseFromString(htmlContent, 'text/html');
  }

  const body = doc.body || doc.documentElement;
  if (!body) return '';

  // Extract text from block-level elements, preserving paragraph structure
  const blocks = body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, dt, dd, figcaption');
  
  if (blocks.length > 0) {
    const texts: string[] = [];
    blocks.forEach(block => {
      const text = block.textContent?.trim();
      if (text) texts.push(text);
    });
    return texts.join('\n');
  }

  // Fallback: get all text content
  return body.textContent?.trim() || '';
}

function extractChapterTitle(htmlContent: string, parser: DOMParser): string | null {
  let doc: Document;
  try {
    doc = parser.parseFromString(htmlContent, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) {
      doc = parser.parseFromString(htmlContent, 'text/html');
    }
  } catch {
    doc = parser.parseFromString(htmlContent, 'text/html');
  }

  // Look for heading elements
  for (const tag of ['h1', 'h2', 'h3', 'title']) {
    const el = doc.querySelector(tag);
    const text = el?.textContent?.trim();
    if (text && text.length < 200) return text;
  }
  return null;
}
