import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';

class PlaywrightMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'playwright-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.browser = null;
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'extract_images',
            description: 'Extract all images from a web page (including dynamically loaded ones)',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'URL of the page to analyze'
                },
                waitTime: {
                  type: 'number',
                  description: 'Wait time in milliseconds for dynamic loading (default: 5000)',
                  default: 5000
                },
                includeDataUrls: {
                  type: 'boolean',
                  description: 'Include base64 images (data:image/...)',
                  default: false
                }
              },
              required: ['url']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'extract_images':
            return await this.extractImages(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      });
    }
    return this.browser;
  }

  async extractImages(args) {
    const { url, waitTime = 5000, includeDataUrls = false } = args;
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    try {
      const page = await context.newPage();
      
      // Capture network requests for images
      const imageUrls = new Set();
      
      page.on('response', async (response) => {
        const responseUrl = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if (contentType.startsWith('image/')) {
          imageUrls.add(responseUrl);
        }
      });

      // Navigate to the page
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      
      // Wait for initial loading
      await page.waitForLoadState('networkidle');
      
      // Wait additional time for dynamic elements
      await page.waitForTimeout(waitTime);
      
      // Scroll the page to trigger lazy loading
      await page.evaluate(() => {
        return new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            
            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });

      // Wait a bit more after scrolling
      await page.waitForTimeout(2000);

      // Extract all images from DOM
      const domImages = await page.evaluate((includeDataUrls) => {
        const images = [];
        
        // Images in <img> tags
        document.querySelectorAll('img').forEach(img => {
          if (img.src) {
            if (includeDataUrls || !img.src.startsWith('data:')) {
              images.push({
                type: 'img',
                src: img.src,
                alt: img.alt || '',
                width: img.naturalWidth || img.width || null,
                height: img.naturalHeight || img.height || null
              });
            }
          }
        });

        // CSS background images
        document.querySelectorAll('*').forEach(el => {
          const style = window.getComputedStyle(el);
          const bgImage = style.backgroundImage;
          
          if (bgImage && bgImage !== 'none') {
            const matches = bgImage.match(/url\(["']?([^"')]+)["']?\)/g);
            if (matches) {
              matches.forEach(match => {
                const url = match.replace(/url\(["']?([^"')]+)["']?\)/, '$1');
                if (includeDataUrls || !url.startsWith('data:')) {
                  images.push({
                    type: 'background',
                    src: url.startsWith('http') ? url : new URL(url, window.location.href).href,
                    element: el.tagName.toLowerCase(),
                    width: null,
                    height: null
                  });
                }
              });
            }
          }
        });

        return images;
      }, includeDataUrls);

      // Combine DOM and network images
      const allImages = [...domImages];
      
      // Add images captured by network requests that aren't already in DOM
      imageUrls.forEach(url => {
        if (!allImages.some(img => img.src === url)) {
          allImages.push({
            type: 'network',
            src: url,
            alt: '',
            width: null,
            height: null
          });
        }
      });

      // Deduplicate by URL
      const uniqueImages = allImages.filter((img, index, self) => 
        index === self.findIndex(i => i.src === img.src)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: url,
              totalImages: uniqueImages.length,
              images: uniqueImages,
              summary: {
                imgTags: domImages.filter(img => img.type === 'img').length,
                backgroundImages: domImages.filter(img => img.type === 'background').length,
                networkImages: imageUrls.size
              }
            }, null, 2)
          }
        ]
      };

    } finally {
      await context.close();
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Playwright MCP Server started');
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('Shutting down server...');
  if (global.mcpServer) {
    await global.mcpServer.cleanup();
  }
  process.exit(0);
});

// Start the server
const server = new PlaywrightMCPServer();
global.mcpServer = server;
server.run().catch(console.error);