/**
 * Image Tools
 * 
 * Tools for image manipulation using ImageMagick WASM.
 * Cross-platform: works on all OS without CLI installation.
 */

const fs = require('fs').promises;
const path = require('path');
const { BaseTool, ToolResult } = require('./base');

// Lazy-load ImageMagick WASM to avoid blocking startup
let ImageMagick = null;
let MagickFormat = null;
let initializePromise = null;

/**
 * Initialize ImageMagick WASM
 */
async function initImageMagick() {
  if (ImageMagick) return;
  
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        const magick = await import('@imagemagick/magick-wasm');
        await magick.initializeImageMagick();
        ImageMagick = magick.ImageMagick;
        MagickFormat = magick.MagickFormat;
        console.log('ImageMagick WASM initialized');
      } catch (error) {
        console.error('Failed to initialize ImageMagick WASM:', error);
        throw error;
      }
    })();
  }
  
  await initializePromise;
}

/**
 * Get MagickFormat from file extension
 */
function getFormatFromExtension(ext) {
  const formats = {
    '.jpg': 'Jpeg',
    '.jpeg': 'Jpeg',
    '.png': 'Png',
    '.gif': 'Gif',
    '.webp': 'WebP',
    '.bmp': 'Bmp',
    '.tiff': 'Tiff',
    '.tif': 'Tiff',
    '.ico': 'Ico',
    '.svg': 'Svg',
    '.pdf': 'Pdf',
    '.heic': 'Heic',
    '.heif': 'Heif',
    '.avif': 'Avif',
  };
  return formats[ext.toLowerCase()] || null;
}

/**
 * Supported formats list
 */
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'svg', 'pdf', 'heic', 'heif', 'avif'];

/**
 * Convert Image Tool
 * Convert images between formats using ImageMagick WASM
 */
class ConvertImageTool extends BaseTool {
  constructor() {
    super({
      name: 'convert_image',
      displayName: 'Convert Image',
      description: `Convert an image from one format to another. Supports: ${SUPPORTED_FORMATS.join(', ')}. Can also resize and adjust quality.`,
      category: 'image',
      parameters: {
        properties: {
          source: {
            type: 'string',
            description: 'Path to the source image file'
          },
          output: {
            type: 'string',
            description: 'Path for the output image file (format detected from extension)'
          },
          width: {
            type: 'number',
            description: 'Optional: Resize to this width (maintains aspect ratio if height not specified)'
          },
          height: {
            type: 'number',
            description: 'Optional: Resize to this height (maintains aspect ratio if width not specified)'
          },
          quality: {
            type: 'number',
            description: 'Optional: Output quality 1-100 (for JPEG, WebP, etc.)'
          }
        },
        required: ['source', 'output']
      },
      examples: [
        { tool: 'convert_image', source: 'C:\\images\\photo.png', output: 'C:\\images\\photo.jpg' },
        { tool: 'convert_image', source: 'image.jpg', output: 'image.webp', quality: 85 },
        { tool: 'convert_image', source: 'large.png', output: 'small.png', width: 800 }
      ],
      timeout: 60000 // Image processing can take a while
    });
  }

  async execute(params, context = {}) {
    const { source, output, width, height, quality } = params;

    // Resolve paths
    const cwd = context.cwd || process.cwd();
    const sourcePath = path.isAbsolute(source) ? source : path.join(cwd, source);
    const outputPath = path.isAbsolute(output) ? output : path.join(cwd, output);

    // Validate source exists
    try {
      await fs.access(sourcePath);
    } catch {
      return ToolResult.failure(`Source file not found: ${sourcePath}`);
    }

    // Get output format from extension
    const outputExt = path.extname(outputPath);
    const formatName = getFormatFromExtension(outputExt);
    
    if (!formatName) {
      return ToolResult.failure(
        `Unsupported output format: ${outputExt}. Supported: ${SUPPORTED_FORMATS.join(', ')}`
      );
    }

    try {
      // Initialize ImageMagick if needed
      await initImageMagick();

      // Read source image
      const sourceData = await fs.readFile(sourcePath);
      const sourceBuffer = new Uint8Array(sourceData);

      let outputBuffer;

      // Process with ImageMagick
      ImageMagick.read(sourceBuffer, (image) => {
        // Resize if requested
        if (width || height) {
          const newWidth = width || 0;
          const newHeight = height || 0;
          
          if (newWidth && newHeight) {
            // Resize to exact dimensions
            image.resize(newWidth, newHeight);
          } else if (newWidth) {
            // Resize to width, maintain aspect ratio
            const ratio = newWidth / image.width;
            image.resize(newWidth, Math.round(image.height * ratio));
          } else if (newHeight) {
            // Resize to height, maintain aspect ratio
            const ratio = newHeight / image.height;
            image.resize(Math.round(image.width * ratio), newHeight);
          }
        }

        // Set quality if applicable
        if (quality && quality >= 1 && quality <= 100) {
          image.quality = quality;
        }

        // Write to the target format
        image.write(MagickFormat[formatName], (data) => {
          outputBuffer = Buffer.from(data);
        });
      });

      if (!outputBuffer) {
        return ToolResult.failure('Failed to convert image: no output produced');
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Write output file
      await fs.writeFile(outputPath, outputBuffer);

      // Get file sizes for output
      const sourceStats = await fs.stat(sourcePath);
      const outputStats = await fs.stat(outputPath);

      const sizeChange = outputStats.size - sourceStats.size;
      const sizeChangeStr = sizeChange > 0 
        ? `+${(sizeChange / 1024).toFixed(1)} KB`
        : `${(sizeChange / 1024).toFixed(1)} KB`;

      let resultMessage = `Successfully converted image:\n`;
      resultMessage += `  Source: ${sourcePath} (${(sourceStats.size / 1024).toFixed(1)} KB)\n`;
      resultMessage += `  Output: ${outputPath} (${(outputStats.size / 1024).toFixed(1)} KB, ${sizeChangeStr})\n`;
      
      if (width || height) {
        resultMessage += `  Resized: ${width || 'auto'} x ${height || 'auto'}\n`;
      }
      if (quality) {
        resultMessage += `  Quality: ${quality}%\n`;
      }

      return ToolResult.success(resultMessage, {
        source: sourcePath,
        output: outputPath,
        sourceSize: sourceStats.size,
        outputSize: outputStats.size,
        format: formatName
      });

    } catch (error) {
      return ToolResult.failure(`Failed to convert image: ${error.message}`);
    }
  }
}

module.exports = {
  ConvertImageTool,
  SUPPORTED_FORMATS
};
