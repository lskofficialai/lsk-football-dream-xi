function copyComputedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const targetStyle = (target as HTMLElement).style;
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    targetStyle.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
}

function cloneWithInlineStyles(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];

  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index];
    if (target) copyComputedStyles(node, target);
  });

  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.margin = '0';
  clone.style.transform = 'none';
  return clone;
}

export async function captureElementToPng(element: HTMLElement, scale = 2): Promise<string> {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const clone = cloneWithInlineStyles(element);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${markup}</foreignObject>
    </svg>
  `;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('战报图生成失败'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  context.scale(scale, scale);
  context.fillStyle = '#071B2D';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

export function downloadPng(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
