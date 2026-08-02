import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import {
  Document,
  ExternalHyperlink,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  SectionType,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from 'docx';

type HtmlLinkBox = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

type HtmlQrBox = {
  dataUri: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

async function renderHtmlWithLinks(
  html: string
): Promise<{
  png: Buffer;
  links: HtmlLinkBox[];
  qrCodes: HtmlQrBox[];
  width: number;
  height: number;
}> {
  // A4 portrait at roughly 300 DPI. Render the HTML at the final document
  // resolution instead of rendering small and scaling the screenshot later.
  // This materially improves text/logo sharpness and gives embedded QR codes
  // enough real pixels to remain scannable in PDF/PPTX/DOCX output.
  const pageWidth = 2480;
  const pageHeight = 3508;
  const safeMargin = 56;

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: pageWidth,
        height: pageHeight,
      },
      deviceScaleFactor: 1,
    });

    await page.setContent(html, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    await page.waitForTimeout(900);

    await page.evaluate(
      ({ pageWidth, pageHeight, safeMargin }) => {
        const body = document.body;
        const htmlElement = document.documentElement;

        if (!body) return;

        // Create one wrapper around all original body content so we can
        // uniformly scale the completed HTML without stretching it.
        let wrapper = document.getElementById('__3d_suite_a4_content');

        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.id = '__3d_suite_a4_content';

          while (body.firstChild) {
            wrapper.appendChild(body.firstChild);
          }

          body.appendChild(wrapper);
        }

        htmlElement.style.margin = '0';
        htmlElement.style.padding = '0';
        htmlElement.style.width = `${pageWidth}px`;
        htmlElement.style.minWidth = `${pageWidth}px`;
        htmlElement.style.height = `${pageHeight}px`;
        htmlElement.style.minHeight = `${pageHeight}px`;
        htmlElement.style.overflow = 'hidden';

        body.style.margin = '0';
        body.style.padding = '0';
        body.style.width = `${pageWidth}px`;
        body.style.minWidth = `${pageWidth}px`;
        body.style.height = `${pageHeight}px`;
        body.style.minHeight = `${pageHeight}px`;
        body.style.overflow = 'hidden';
        body.style.position = 'relative';

        wrapper.style.position = 'absolute';
        wrapper.style.left = '0';
        wrapper.style.top = '0';
        wrapper.style.transformOrigin = 'top left';
        wrapper.style.transform = 'none';
        wrapper.style.width = 'max-content';
        wrapper.style.maxWidth = 'none';

        // Measure the natural rendered content.
        const rect = wrapper.getBoundingClientRect();

        const contentWidth = Math.max(
          rect.width,
          wrapper.scrollWidth,
          1
        );

        const contentHeight = Math.max(
          rect.height,
          wrapper.scrollHeight,
          1
        );

        const usableWidth = pageWidth - safeMargin * 2;
        const usableHeight = pageHeight - safeMargin * 2;

        // Scale both UP and DOWN. This is the key difference from the
        // previous version, which often left small HTML designs tiny.
        const scale = Math.min(
          usableWidth / contentWidth,
          usableHeight / contentHeight
        );

        const finalWidth = contentWidth * scale;
        const finalHeight = contentHeight * scale;

        const offsetX =
          safeMargin + Math.max(0, (usableWidth - finalWidth) / 2);

        const offsetY =
          safeMargin + Math.max(0, (usableHeight - finalHeight) / 2);

        wrapper.style.left = `${offsetX}px`;
        wrapper.style.top = `${offsetY}px`;
        wrapper.style.transform = `scale(${scale})`;
      },
      { pageWidth, pageHeight, safeMargin }
    );

    await page.waitForTimeout(250);

    const links = await page.evaluate(
      ({ pageWidth, pageHeight }) =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((anchor) => {
            const rect = anchor.getBoundingClientRect();
            const href = (anchor as HTMLAnchorElement).href || '';

            return {
              href,
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              pageWidth,
              pageHeight,
            };
          })
          .filter(
            (item) =>
              item.href &&
              item.width > 0 &&
              item.height > 0
          ),
      { pageWidth, pageHeight }
    );

    const qrCodes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src^="data:image/png;base64,"]'))
        .map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            dataUri: (image as HTMLImageElement).src || '',
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(
          (item) =>
            item.dataUri &&
            item.width > 0 &&
            item.height > 0
        )
    );

    const png = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      },
    });

    return {
      png,
      links,
      qrCodes,
      width: pageWidth,
      height: pageHeight,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function renderHtmlToPng(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);
  return rendered.png;
}

export async function htmlToPdfBuffer(
  html: string
): Promise<Buffer> {
  // Keep the source render at 300-DPI quality, but place it on a true A4
  // CSS page before printing. Using the 2480x3508 source dimensions as CSS
  // pixels causes Chromium to treat the page as physically huge and crop it.
  const rendered = await renderHtmlWithLinks(html);

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 794,
        height: 1123,
      },
      deviceScaleFactor: 1,
    });

    const imageDataUri =
      `data:image/png;base64,${rendered.png.toString('base64')}`;

    const qrOverlays = rendered.qrCodes
      .map((qr) => {
        const left = (qr.x / rendered.width) * 100;
        const top = (qr.y / rendered.height) * 100;
        const width = (qr.width / rendered.width) * 100;
        const height = (qr.height / rendered.height) * 100;

        return `
          <img
            src="${qr.dataUri}"
            alt="QR code"
            style="
              position:absolute;
              left:${left}%;
              top:${top}%;
              width:${width}%;
              height:${height}%;
              image-rendering:auto;
              z-index:5;
            "
          />
        `;
      })
      .join('\n');

    const linkOverlays = rendered.links
      .map((link) => {
        const safeHref = link.href
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        const left = (link.x / rendered.width) * 100;
        const top = (link.y / rendered.height) * 100;
        const width = (link.width / rendered.width) * 100;
        const height = (link.height / rendered.height) * 100;

        return `
          <a
            href="${safeHref}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open link"
            style="
              position:absolute;
              left:${left}%;
              top:${top}%;
              width:${width}%;
              height:${height}%;
              display:flex;
              align-items:center;
              justify-content:center;
              z-index:20;
              overflow:hidden;
              color:transparent;
              font-size:1px;
              line-height:1;
              text-decoration:none;
              background:rgba(255,255,255,0.001);
              pointer-events:auto;
              -webkit-print-color-adjust:exact;
              print-color-adjust:exact;
            "
          >OPEN</a>
        `;
      })
      .join('\n');

    await page.setContent(
      `
      <html>
        <head>
          <style>
            @page {
              size: A4 portrait;
              margin: 0;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              width: 210mm;
              height: 297mm;
              overflow: hidden;
              background: white;
            }

            #page {
              position: relative;
              width: 210mm;
              height: 297mm;
              overflow: hidden;
            }

            #page-image {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
              object-fit: fill;
              display: block;
            }
          </style>
        </head>
        <body>
          <div id="page">
            <img id="page-image" src="${imageDataUri}" />
            ${qrOverlays}
            ${linkOverlays}
          </div>
        </body>
      </html>
      `,
      {
        waitUntil: 'load',
      }
    );

    await page.waitForTimeout(200);

    return Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        pageRanges: '1',
        margin: {
          top: '0mm',
          right: '0mm',
          bottom: '0mm',
          left: '0mm',
        },
      })
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function htmlToSvgBuffer(html: string): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  const escapeXmlAttribute = (value: string) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const imageDataUri =
    `data:image/png;base64,${rendered.png.toString('base64')}`;

  const linkOverlays = rendered.links
    .map((link) => {
      const href = escapeXmlAttribute(link.href);
      const x = Math.max(0, link.x);
      const y = Math.max(0, link.y);
      const width = Math.max(1, link.width);
      const height = Math.max(1, link.height);

      return `
  <a href="${href}" target="_blank">
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      fill="#ffffff"
      fill-opacity="0.001"
      stroke="none"
      pointer-events="all"
    />
  </a>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${rendered.width}"
  height="${rendered.height}"
  viewBox="0 0 ${rendered.width} ${rendered.height}"
  preserveAspectRatio="xMidYMid meet"
>
  <image
    x="0"
    y="0"
    width="${rendered.width}"
    height="${rendered.height}"
    href="${imageDataUri}"
    xlink:href="${imageDataUri}"
    preserveAspectRatio="xMidYMid meet"
  />${linkOverlays}
</svg>`;

  return Buffer.from(svg, 'utf8');
}

async function sliceRenderedPng(
  png: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  pageAspect: number
): Promise<Array<{
  data: Buffer;
  sourceY: number;
  sourceHeight: number;
}>> {
  // Use Playwright itself to crop the rendered PNG into page/slide-sized pieces.
  // This avoids introducing an additional image-processing dependency.
  const browser = await chromium.launch({ headless: true });

  try {
    const slices: Array<{
      data: Buffer;
      sourceY: number;
      sourceHeight: number;
    }> = [];

    const sliceHeight = Math.max(
      1,
      Math.floor(sourceWidth / pageAspect)
    );

    for (
      let sourceY = 0;
      sourceY < sourceHeight;
      sourceY += sliceHeight
    ) {
      const currentHeight = Math.min(
        sliceHeight,
        sourceHeight - sourceY
      );

      const page = await browser.newPage({
        viewport: {
          width: sourceWidth,
          height: currentHeight,
        },
      });

      const dataUri =
        `data:image/png;base64,${png.toString('base64')}`;

      await page.setContent(
        `<html><body style="margin:0;overflow:hidden;">
          <img src="${dataUri}"
               style="position:absolute;left:0;top:-${sourceY}px;width:${sourceWidth}px;height:${sourceHeight}px;max-width:none;">
        </body></html>`,
        { waitUntil: 'load' }
      );

      slices.push({
        data: await page.screenshot({
          type: 'png',
          clip: {
            x: 0,
            y: 0,
            width: sourceWidth,
            height: currentHeight,
          },
        }),
        sourceY,
        sourceHeight: currentHeight,
      });

      await page.close();
    }

    return slices;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function htmlToDocxBuffer(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  // Word documents use a full-page, high-resolution background image so the
  // visual result stays identical to the HTML/PDF/PPTX versions. Hyperlinks
  // are then added back as transparent floating PNG overlays positioned over
  // the exact bounds measured from the original HTML anchors.
  const pageWidthPx = 794; // A4 at 96 CSS px/in
  const pageHeightPx = 1123;
  const emuPerInch = 914400;
  const pageWidthInches = 8.27;
  const pageHeightInches = 11.69;

  const toXEmu = (sourceX: number) =>
    Math.round(
      (sourceX / rendered.width) *
        pageWidthInches *
        emuPerInch
    );

  const toYEmu = (sourceY: number) =>
    Math.round(
      (sourceY / rendered.height) *
        pageHeightInches *
        emuPerInch
    );

  const toWidthPx = (sourceWidth: number) =>
    Math.max(
      1,
      Math.round(
        (sourceWidth / rendered.width) *
          pageWidthPx
      )
    );

  const toHeightPx = (sourceHeight: number) =>
    Math.max(
      1,
      Math.round(
        (sourceHeight / rendered.height) *
          pageHeightPx
      )
    );

  const pageImage = new ImageRun({
    data: rendered.png,
    transformation: {
      width: pageWidthPx,
      height: pageHeightPx,
    },
    type: 'png',
    floating: {
      horizontalPosition: {
        relative: HorizontalPositionRelativeFrom.PAGE,
        offset: 0,
      },
      verticalPosition: {
        relative: VerticalPositionRelativeFrom.PAGE,
        offset: 0,
      },
      wrap: {
        type: TextWrappingType.NONE,
      },
      behindDocument: true,
      allowOverlap: true,
      lockAnchor: true,
    },
  });

  // A fully transparent 1x1 PNG. Word still creates a real DrawingML object
  // for it, which allows docx.js to attach an external hyperlink relationship.
  // Scaling that image to each measured link rectangle gives us invisible but
  // genuinely clickable hotspots over the rendered page.
  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const overlayLinks = rendered.links
    .filter((link) => /^https?:\/\//i.test(link.href))
    .map((link) => {
      const overlayImage = new ImageRun({
        data: transparentPng,
        transformation: {
          width: toWidthPx(link.width),
          height: toHeightPx(link.height),
        },
        type: 'png',
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            offset: toXEmu(link.x),
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            offset: toYEmu(link.y),
          },
          wrap: {
            type: TextWrappingType.NONE,
          },
          behindDocument: false,
          allowOverlap: true,
          lockAnchor: true,
        },
      });

      return new ExternalHyperlink({
        children: [overlayImage],
        link: link.href,
      });
    });

  // Keep a tiny fallback hyperlink in the document structure. It is visually
  // unobtrusive, but gives viewers that do not activate hyperlinks on floating
  // drawings (some browser previews) a standards-based link target as well.
  const primaryLink = rendered.links.find(
    (link) => /^https?:\/\//i.test(link.href)
  );

  const fallbackParagraph = primaryLink
    ? new Paragraph({
        spacing: {
          before: 0,
          after: 0,
          line: 1,
        },
        children: [
          new ExternalHyperlink({
            link: primaryLink.href,
            children: [
              new TextRun({
                text: 'Open link',
                size: 2,
                color: 'FFFFFF',
              }),
            ],
          }),
        ],
      })
    : null;

  const children: Paragraph[] = [
    new Paragraph({
      spacing: {
        before: 0,
        after: 0,
        line: 1,
      },
      children: [
        pageImage,
        ...overlayLinks,
      ],
    }),
  ];

  if (fallbackParagraph) {
    children.push(fallbackParagraph);
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
          page: {
            size: {
              width: 11906,
              height: 16838,
            },
            margin: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              header: 0,
              footer: 0,
              gutter: 0,
            },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

export async function htmlToPptxBuffer(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: 'A4_PORTRAIT',
    width: 8.27,
    height: 11.69,
  });
  pptx.layout = 'A4_PORTRAIT';

  const slideW = 8.27;
  const slideH = 11.69;

  const slide = pptx.addSlide();

  // The rendered PNG already has the exact A4 aspect ratio.
  // Fill the full portrait slide without any extra letterboxing.
  slide.addImage({
    data:
      `data:image/png;base64,${rendered.png.toString('base64')}`,
    x: 0,
    y: 0,
    w: slideW,
    h: slideH,
  });

  // Re-embed QR images at their exact coordinates using the original
  // high-resolution PNG data URI. This preserves clean square modules even
  // when the page background is scaled by PowerPoint.
  for (const qr of rendered.qrCodes) {
    slide.addImage({
      data: qr.dataUri,
      x: (qr.x / rendered.width) * slideW,
      y: (qr.y / rendered.height) * slideH,
      w: (qr.width / rendered.width) * slideW,
      h: (qr.height / rendered.height) * slideH,
    });
  }

  // Link bounds are already measured after the A4 scaling.
  for (const link of rendered.links) {
    const x =
      (link.x / rendered.width) * slideW;

    const y =
      (link.y / rendered.height) * slideH;

    const w =
      (link.width / rendered.width) * slideW;

    const h =
      (link.height / rendered.height) * slideH;

    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      line: {
        color: 'FFFFFF',
        transparency: 100,
      },
      fill: {
        color: 'FFFFFF',
        transparency: 100,
      },
      hyperlink: {
        url: link.href,
      },
    });
  }

  const output = await pptx.write({
    outputType: 'nodebuffer',
  });

  return Buffer.from(output as Buffer);
}

