#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import StreamZip from 'node-stream-zip';
import { promises as fs } from 'fs';
import path from 'path';

class PowerPointMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'powerpoint-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'read_pptx',
            description: 'Read and extract content from PowerPoint PPTX files',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the PPTX file to read',
                },
              },
              required: ['file_path'],
            },
          },
          {
            name: 'list_slides',
            description: 'List all slides in a PowerPoint PPTX file with basic information',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the PPTX file',
                },
              },
              required: ['file_path'],
            },
          },
          {
            name: 'extract_slide_text',
            description: 'Extract text content from a specific slide',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the PPTX file',
                },
                slide_number: {
                  type: 'number',
                  description: 'Slide number (1-based index)',
                },
              },
              required: ['file_path', 'slide_number'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'read_pptx':
            return await this.readPPTX(args.file_path);
          case 'list_slides':
            return await this.listSlides(args.file_path);
          case 'extract_slide_text':
            return await this.extractSlideText(args.file_path, args.slide_number);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
      }
    });
  }

  async readPPTX(filePath) {
    try {
      // Check if file exists
      await fs.access(filePath);
      
      const zip = new StreamZip.async({ file: filePath });
      const entries = await zip.entries();
      
      // Extract presentation structure
      const slides = [];
      const slideFiles = Object.keys(entries).filter(name => 
        name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
      ).sort();
      
      for (const slideFile of slideFiles) {
        const slideContent = await zip.entryData(slideFile);
        const slideText = this.extractTextFromSlideXML(slideContent.toString());
        const slideNumber = parseInt(slideFile.match(/slide(\d+)\.xml/)[1]);
        
        slides.push({
          number: slideNumber,
          file: slideFile,
          text: slideText
        });
      }
      
      await zip.close();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              file: path.basename(filePath),
              totalSlides: slides.length,
              slides: slides
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to read PPTX file: ${error.message}`);
    }
  }

  async listSlides(filePath) {
    try {
      await fs.access(filePath);
      
      const zip = new StreamZip.async({ file: filePath });
      const entries = await zip.entries();
      
      const slideFiles = Object.keys(entries).filter(name => 
        name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
      ).sort();
      
      const slideList = slideFiles.map(slideFile => {
        const slideNumber = parseInt(slideFile.match(/slide(\d+)\.xml/)[1]);
        return {
          number: slideNumber,
          file: slideFile
        };
      });
      
      await zip.close();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              file: path.basename(filePath),
              totalSlides: slideList.length,
              slides: slideList
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to list slides: ${error.message}`);
    }
  }

  async extractSlideText(filePath, slideNumber) {
    try {
      await fs.access(filePath);
      
      const zip = new StreamZip.async({ file: filePath });
      const slideFile = `ppt/slides/slide${slideNumber}.xml`;
      
      try {
        const slideContent = await zip.entryData(slideFile);
        const slideText = this.extractTextFromSlideXML(slideContent.toString());
        
        await zip.close();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                file: path.basename(filePath),
                slideNumber: slideNumber,
                text: slideText
              }, null, 2)
            }
          ]
        };
      } catch (entryError) {
        await zip.close();
        throw new Error(`Slide ${slideNumber} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to extract slide text: ${error.message}`);
    }
  }

  extractTextFromSlideXML(xmlContent) {
    // Simple XML text extraction - removes XML tags and extracts text content
    // This is a basic implementation that looks for text in <a:t> tags
    const textMatches = xmlContent.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const texts = textMatches.map(match => {
      const textContent = match.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '');
      return textContent.trim();
    }).filter(text => text.length > 0);
    
    return texts.join(' ');
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server
const server = new PowerPointMCPServer();
server.run().catch(console.error);