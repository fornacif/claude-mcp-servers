#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

class ExcelMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "excel-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.setupHandlers();
  }

  validateFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path is required and must be a string');
    }
    
    if (!path.isAbsolute(filePath)) {
      throw new Error('File path must be absolute');
    }

    const resolvedPath = path.resolve(filePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new Error('File must be an Excel file (.xlsx, .xls) or CSV file (.csv)');
    }

    return resolvedPath;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "read_excel_file",
            description: "Read data from an Excel file (.xlsx, .xls) or CSV file",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Absolute path to the Excel or CSV file"
                },
                sheet_name: {
                  type: "string",
                  description: "Name of the worksheet to read (optional, defaults to first sheet)"
                },
                range: {
                  type: "string",
                  description: "Cell range to read (e.g., 'A1:C10', optional)"
                },
                headers: {
                  type: "boolean",
                  description: "Whether the first row contains headers (default: true)"
                }
              },
              required: ["file_path"]
            }
          },
          {
            name: "write_excel_file",
            description: "Write data to an Excel file (.xlsx) or CSV file",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Absolute path where to save the Excel or CSV file"
                },
                data: {
                  type: "array",
                  description: "Array of objects representing rows of data",
                  items: {
                    type: "object"
                  }
                },
                sheet_name: {
                  type: "string",
                  description: "Name of the worksheet (optional, defaults to 'Sheet1')"
                },
                append: {
                  type: "boolean",
                  description: "Whether to append to existing file (default: false)"
                }
              },
              required: ["file_path", "data"]
            }
          },
          {
            name: "list_excel_sheets",
            description: "List all worksheet names in an Excel file",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Absolute path to the Excel file"
                }
              },
              required: ["file_path"]
            }
          },
          {
            name: "get_excel_info",
            description: "Get information about an Excel file (sheets, dimensions, etc.)",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Absolute path to the Excel file"
                }
              },
              required: ["file_path"]
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "read_excel_file":
            return await this.readExcelFile(args);
          case "write_excel_file":
            return await this.writeExcelFile(args);
          case "list_excel_sheets":
            return await this.listExcelSheets(args);
          case "get_excel_info":
            return await this.getExcelInfo(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true
        };
      }
    });
  }

  // Helper method to safely read Excel files with error handling
  readWorkbook(filePath) {
    try {
      // Method 1: Try the standard readFile method
      if (typeof XLSX.readFile === 'function') {
        return XLSX.readFile(filePath);
      }
      
      // Method 2: Try reading buffer first then parsing
      const buffer = fs.readFileSync(filePath);
      return XLSX.read(buffer, { type: 'buffer' });
      
    } catch (error) {
      throw new Error(`Failed to read workbook: ${error.message}`);
    }
  }

  async readExcelFile(args = {}) {
    const filePath = this.validateFilePath(args.file_path);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      const workbook = this.readWorkbook(filePath);
      const sheetName = args.sheet_name || workbook.SheetNames[0];
      
      if (!workbook.Sheets[sheetName]) {
        throw new Error(`Sheet '${sheetName}' not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
      }

      const worksheet = workbook.Sheets[sheetName];
      
      let data;
      if (args.range) {
        const rangeData = XLSX.utils.sheet_to_json(worksheet, {
          range: args.range,
          header: args.headers !== false ? 1 : undefined,
          defval: ''
        });
        data = rangeData;
      } else {
        data = XLSX.utils.sheet_to_json(worksheet, {
          header: args.headers !== false ? 1 : undefined,
          defval: ''
        });
      }

      let responseText = `**Excel File Read Successfully**\n\n`;
      responseText += `**File:** ${filePath}\n`;
      responseText += `**Sheet:** ${sheetName}\n`;
      responseText += `**Rows:** ${data.length}\n`;
      
      if (data.length > 0) {
        const columns = Object.keys(data[0]);
        responseText += `**Columns:** ${columns.length} (${columns.join(', ')})\n\n`;
        
        if (args.range) {
          responseText += `**Range:** ${args.range}\n\n`;
        }
        
        responseText += `**Data:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
      } else {
        responseText += `\nNo data found in the specified range.`;
      }

      return {
        content: [{ type: "text", text: responseText }]
      };
    } catch (error) {
      throw new Error(`Failed to read Excel file: ${error.message}`);
    }
  }

  async writeExcelFile(args = {}) {
    const filePath = this.validateFilePath(args.file_path);
    
    if (!Array.isArray(args.data)) {
      throw new Error('Data must be an array of objects');
    }

    if (args.data.length === 0) {
      throw new Error('Data array cannot be empty');
    }

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let workbook;
      const ext = path.extname(filePath).toLowerCase();
      
      if (ext === '.csv') {
        const worksheet = XLSX.utils.json_to_sheet(args.data);
        workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        
        // Use writeFile or writeFileSync depending on availability
        if (typeof XLSX.writeFile === 'function') {
          XLSX.writeFile(workbook, filePath);
        } else {
          const buffer = XLSX.write(workbook, { bookType: 'csv', type: 'buffer' });
          fs.writeFileSync(filePath, buffer);
        }
      } else {
        if (args.append && fs.existsSync(filePath)) {
          workbook = this.readWorkbook(filePath);
        } else {
          workbook = XLSX.utils.book_new();
        }

        const sheetName = args.sheet_name || 'Sheet1';
        const worksheet = XLSX.utils.json_to_sheet(args.data);
        
        if (workbook.Sheets[sheetName] && args.append) {
          const existingData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
          const combinedData = existingData.concat(args.data);
          const newWorksheet = XLSX.utils.json_to_sheet(combinedData);
          workbook.Sheets[sheetName] = newWorksheet;
        } else {
          if (workbook.Sheets[sheetName]) {
            delete workbook.Sheets[sheetName];
            const index = workbook.SheetNames.indexOf(sheetName);
            if (index > -1) {
              workbook.SheetNames.splice(index, 1);
            }
          }
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        }

        // Use writeFile or writeFileSync depending on availability
        if (typeof XLSX.writeFile === 'function') {
          XLSX.writeFile(workbook, filePath);
        } else {
          const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
          fs.writeFileSync(filePath, buffer);
        }
      }

      let responseText = `**Excel File Written Successfully**\n\n`;
      responseText += `**File:** ${filePath}\n`;
      responseText += `**Rows Written:** ${args.data.length}\n`;
      
      if (ext !== '.csv') {
        responseText += `**Sheet:** ${args.sheet_name || 'Sheet1'}\n`;
        responseText += `**Mode:** ${args.append ? 'Append' : 'Overwrite'}\n`;
      }
      
      const columns = Object.keys(args.data[0]);
      responseText += `**Columns:** ${columns.length} (${columns.join(', ')})\n`;

      return {
        content: [{ type: "text", text: responseText }]
      };
    } catch (error) {
      throw new Error(`Failed to write Excel file: ${error.message}`);
    }
  }

  async listExcelSheets(args = {}) {
    const filePath = this.validateFilePath(args.file_path);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') {
      return {
        content: [{ type: "text", text: "CSV files don't have multiple sheets. Single sheet: 'Sheet1'" }]
      };
    }

    try {
      const workbook = this.readWorkbook(filePath);
      
      let responseText = `**Excel Sheets**\n\n`;
      responseText += `**File:** ${filePath}\n`;
      responseText += `**Total Sheets:** ${workbook.SheetNames.length}\n\n`;
      
      responseText += `**Sheet Names:**\n`;
      workbook.SheetNames.forEach((name, index) => {
        responseText += `${index + 1}. ${name}\n`;
      });

      return {
        content: [{ type: "text", text: responseText }]
      };
    } catch (error) {
      throw new Error(`Failed to read Excel file: ${error.message}`);
    }
  }

  async getExcelInfo(args = {}) {
    const filePath = this.validateFilePath(args.file_path);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      const stats = fs.statSync(filePath);
      const workbook = this.readWorkbook(filePath);
      
      let responseText = `**Excel File Information**\n\n`;
      responseText += `**File:** ${filePath}\n`;
      responseText += `**File Size:** ${(stats.size / 1024).toFixed(2)} KB\n`;
      responseText += `**Last Modified:** ${stats.mtime.toISOString()}\n`;
      responseText += `**Total Sheets:** ${workbook.SheetNames.length}\n\n`;
      
      responseText += `**Sheet Details:**\n`;
      
      workbook.SheetNames.forEach((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const rowCount = range.e.r - range.s.r + 1;
        const colCount = range.e.c - range.s.c + 1;
        
        responseText += `${index + 1}. **${sheetName}**\n`;
        responseText += `   - Range: ${worksheet['!ref'] || 'Empty'}\n`;
        responseText += `   - Rows: ${rowCount}\n`;
        responseText += `   - Columns: ${colCount}\n`;
        
        if (worksheet['!ref']) {
          const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          if (data.length > 0 && data[0].length > 0) {
            const headers = data[0].filter(h => h !== undefined && h !== '');
            if (headers.length > 0) {
              responseText += `   - Headers: ${headers.join(', ')}\n`;
            }
          }
        }
        responseText += '\n';
      });

      return {
        content: [{ type: "text", text: responseText }]
      };
    } catch (error) {
      throw new Error(`Failed to get Excel file info: ${error.message}`);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Excel MCP server started");
  }
}

const server = new ExcelMCPServer();
server.start().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});