import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";

// Load environment variables
config();

// Validate required environment variables
const requiredEnvVars = [
  'AEM_BASE_URL',
  'ADOBE_IMS_CLIENT_ID', 
  'ADOBE_IMS_CLIENT_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please create a .env file with the required variables. See .env.example for reference.');
  process.exit(1);
}

// Configuration
const AEM_CONFIG = {
  baseUrl: process.env.AEM_BASE_URL,
  endpoints: {
    contentFragments: "/adobe/sites/cf/fragments",
    contentFragmentModels: "/adobe/sites/cf/models",
    assetsImport: "/adobe/assets/import/fromUrl",
    folders: "/adobe/folders",
    createFolders: "/adobe/folders/",
    createContentFragment: "/adobe/sites/cf/fragments"
  },
  bearerToken: null,
  imsConfig: {
    tokenUrl: process.env.ADOBE_IMS_TOKEN_URL || "https://ims-na1.adobelogin.com/ims/token/v3",
    clientId: process.env.ADOBE_IMS_CLIENT_ID,
    clientSecret: process.env.ADOBE_IMS_CLIENT_SECRET,
    scope: process.env.ADOBE_IMS_SCOPES || "openid,AdobeID,aem.assets.author,aem.folders,aem.fragments.management"
  },
  
  // Helper method to build full URLs
  getUrl(endpoint) {
    return `${this.baseUrl}${this.endpoints[endpoint]}`;
  }
};

class AEMMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "aem-mcp-server",
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

  async makeRequest(url, options = {}) {
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null
      });

      let data;
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        data: data
      };
    } catch (error) {
      throw new Error(`Request failed: ${error.message}`);
    }
  }

  async getBearerToken() {
    const { tokenUrl, clientId, clientSecret, scope } = AEM_CONFIG.imsConfig;
    
    const formData = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope
    });

    const response = await this.makeRequest(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!response.ok) {
      throw new Error(`Adobe IMS authentication error: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    if (!response.data.access_token) {
      throw new Error('No access_token received from Adobe IMS');
    }

    AEM_CONFIG.bearerToken = response.data.access_token;
    console.error(`Token retrieved successfully. Expires in ${response.data.expires_in} seconds`);
    
    return response.data.access_token;
  }

  async ensureValidToken() {
    if (!AEM_CONFIG.bearerToken) {
      await this.getBearerToken();
    }
    return AEM_CONFIG.bearerToken;
  }

  async makeAEMRequest(url, options = {}) {
    await this.ensureValidToken();
    
    const headers = {
      'Authorization': `Bearer ${AEM_CONFIG.bearerToken}`,
      'x-api-key': AEM_CONFIG.imsConfig.clientId,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const requestOptions = {
      method: options.method || 'GET',
      headers: headers
    };

    if (options.data) {
      requestOptions.body = JSON.stringify(options.data);
    }

    const response = await this.makeRequest(url, requestOptions);

    if (!response.ok) {
      throw new Error(`AEM API error: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    return response.data;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "list_content_fragments",
            description: "Retrieves the list of AEM Content Fragments",
            inputSchema: {
              type: "object",
              properties: {
                cursor: { type: "string" },
                limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
                path: { type: "string" },
                references: { 
                  type: "string", 
                  enum: ["direct", "direct-hydrated", "all", "all-hydrated"],
                  default: "direct-hydrated"
                },
                projection: { 
                  type: "string", 
                  enum: ["minimal", "summary", "full"],
                  default: "full"
                }
              }
            }
          },
          {
            name: "list_content_fragment_models",
            description: "Retrieves the list of AEM Content Fragment Models",
            inputSchema: {
              type: "object",
              properties: {
                cursor: { type: "string" },
                limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
                projection: { 
                  type: "string", 
                  enum: ["minimal", "summary", "full"],
                  default: "full"
                }
              }
            }
          },
          {
            name: "list_folders",
            description: "Retrieves the list of AEM folders with title and ID",
            inputSchema: {
              type: "object",
              properties: {
                path: { 
                  type: "string", 
                  default: "/content/dam",
                  description: "Path of the folder from which to list the children"
                },
                limit: { 
                  type: "number", 
                  minimum: 1, 
                  maximum: 50, 
                  default: 50,
                  description: "Maximum number of folders to return"
                },
                cursor: { 
                  type: "string",
                  description: "Cursor for pagination"
                }
              }
            }
          },
          {
            name: "create_folders",
            description: "Creates one or more folders in AEM (up to 10 folders can be created in a single request)",
            inputSchema: {
              type: "object",
              properties: {
                folders: {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      path: { 
                        type: "string", 
                        description: "The path where the folder should be created"
                      },
                      title: { 
                        type: "string", 
                        description: "The display title for the folder"
                      }
                    },
                    required: ["path"]
                  },
                  description: "Array of folders to create (minimum 1, maximum 10 folders)"
                }
              },
              required: ["folders"]
            }
          },
          {
            name: "import_assets_from_url",
            description: "Imports assets from URLs into AEM",
            inputSchema: {
              type: "object",
              properties: {
                folder: { type: "string", minLength: 1, description: "The ID or path for the folder into which to import the assets in AEM." },
                files: {
                  type: "array",
                  minItems: 1,
                  maxItems: 300,
                  items: {
                    type: "object",
                    properties: {
                      fileName: { type: "string" },
                      url: { type: "string", minLength: 10 },
                      assetMetadata: { type: "object" }
                    },
                    required: ["fileName", "url"]
                  }
                },
                sourceName: { type: "string" }
              },
              required: ["folder", "files"]
            }
          },
          {
            name: "create_content_fragment",
            description: "Creates a new Content Fragment in AEM",
            inputSchema: {
              type: "object",
              properties: {
                title: { 
                  type: "string", 
                  description: "The title of the new Content Fragment" 
                },
                description: { 
                  type: "string", 
                  description: "The description of the new Content Fragment" 
                },
                modelId: { 
                  type: "string", 
                  description: "Base64URL encoded ID of the Content Fragment Model with no padding" 
                },
                parentPath: { 
                  type: "string", 
                  description: "The folder path where the Content Fragment should be created (relative to /content/dam)" 
                },
                name: { 
                  type: "string", 
                  description: "Optional name for the Content Fragment. If not provided, will be derived from title" 
                },
                fields: {
                  type: "array",
                  description: "Array of field data for populating the content fragment",
                  items: {
                    type: "object",
                    properties: {
                      name: { 
                        type: "string", 
                        description: "The name of the field" 
                      },
                      type: { 
                        type: "string", 
                        enum: [
                          "text", "long-text", "number", "float-number", 
                          "date-time", "date", "time", "boolean", 
                          "enumeration", "tag", "content-fragment", 
                          "content-reference", "json"
                        ],
                        description: "Type of data stored in the field" 
                      },
                      values: { 
                        type: "array",
                        description: "Array of values for the field (even single values should be in an array)"
                      },
                      multiple: { 
                        type: "boolean", 
                        default: false,
                        description: "Whether the field has multiple values" 
                      },
                      locked: { 
                        type: "boolean", 
                        default: false,
                        description: "Whether the field is locked for editing" 
                      }
                    },
                    required: ["name", "type"]
                  }
                }
              },
              required: ["title", "modelId", "parentPath"]
            }
          },
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "list_content_fragments") {
          return await this.listContentFragments(args);
        } else if (name === "list_content_fragment_models") {
          return await this.listContentFragmentModels(args);
        } else if (name === "list_folders") {
          return await this.listFolders(args);
        } else if (name === "create_folders") {
          return await this.createFolders(args);
        } else if (name === "import_assets_from_url") {
          return await this.importAssetsFromUrl(args);
        } else if (name === "create_content_fragment") {
          return await this.createContentFragment(args);
        } else {
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

  async listContentFragmentModels(args = {}) {
    const params = new URLSearchParams();
    
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });

    const queryString = params.toString();
    const url = `${AEM_CONFIG.getUrl('contentFragmentModels')}${queryString ? '?' + queryString : ''}`;
    
    const result = await this.makeAEMRequest(url);
    
    if (!result.items || result.items.length === 0) {
      return {
        content: [{ type: "text", text: "No content fragment models found." }]
      };
    }

    // Return the complete JSON response instead of formatted text
    let responseText = `**AEM Content Fragment Models API Response:**\n\n`;
    responseText += `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
    
    return {
      content: [{ type: "text", text: responseText }]
    };
}

  async createFolders(args = {}) {
    // Validate required parameters
    if (!args.folders || !Array.isArray(args.folders) || args.folders.length === 0) {
      throw new Error('Missing required parameter: folders array is required and must contain at least one folder');
    }

    if (args.folders.length > 10) {
      throw new Error('Too many folders: maximum 10 folders can be created in a single request');
    }

    // Validate each folder
    args.folders.forEach((folder, index) => {
      if (!folder.path) {
        throw new Error(`Folder at index ${index} is missing required property: path`);
      }
      if (typeof folder.path !== 'string' || folder.path.trim().length === 0) {
        throw new Error(`Folder at index ${index} has invalid path: must be a non-empty string`);
      }
    });

    // Prepare the request data (AEM expects an array)
    const requestData = args.folders.map(folder => ({
      path: folder.path,
      ...(folder.title && { title: folder.title })
    }));

    const result = await this.makeAEMRequest(AEM_CONFIG.getUrl('createFolders'), {
      method: 'POST',
      data: requestData
    });

    let responseText = `**Folders Creation Request Submitted Successfully**\n\n`;
    
    if (Array.isArray(result)) {
      responseText += `**Created Folders (${result.length}):**\n\n`;
      
      result.forEach((folder, index) => {
        responseText += `${index + 1}. **${folder.title || folder.name || 'Untitled'}**\n`;
        responseText += `   - Path: ${folder.path}\n`;
        responseText += `   - ID: ${folder.folderId || 'N/A'}\n`;
        if (folder.status) responseText += `   - Status: ${folder.status}\n`;
        responseText += '\n';
      });
    } else if (result && typeof result === 'object') {
      // Single folder response
      responseText += `**Created Folder:**\n`;
      responseText += `- **${result.title || result.name || 'Untitled'}**\n`;
      responseText += `  - Path: ${result.path}\n`;
      responseText += `  - ID: ${result.folderId || 'N/A'}\n`;
      if (result.status) responseText += `  - Status: ${result.status}\n`;
    } else {
      responseText += `**Response:** ${JSON.stringify(result, null, 2)}`;
    }

    return {
      content: [{ type: "text", text: responseText }]
    };
  }

  async listFolders(args = {}) {
    const params = new URLSearchParams();
    
    // Set default path if not provided
    const path = args.path || "/content/dam";
    params.append('path', path);
    
    // Add other parameters if provided
    if (args.limit !== undefined) {
      params.append('limit', args.limit.toString());
    }
    if (args.cursor) {
      params.append('cursor', args.cursor);
    }

    const queryString = params.toString();
    const url = `${AEM_CONFIG.getUrl('folders')}?${queryString}`;
    
    const result = await this.makeAEMRequest(url);
    
    if (!result) {
      return {
        content: [{ type: "text", text: "No folder data returned." }]
      };
    }

    let responseText = `**AEM Folders**\n\n`;
    
    // Handle self folder (current folder info)
    if (result.self) {
      responseText += `**Current Folder:**\n`;
      responseText += `- **${result.self.title || result.self.name}**\n`;
      responseText += `  - ID: ${result.self.folderId}\n`;
      responseText += `  - Path: ${result.self.path}\n\n`;
    }
    
    // Handle children folders
    if (result.children && result.children.length > 0) {
      responseText += `**Child Folders (${result.children.length}):**\n\n`;
      
      const foldersList = result.children.map(folder => {
        return `**${folder.title || folder.name}**
  - ID: ${folder.folderId}
  - Path: ${folder.path}
  - Name: ${folder.name}`;
      });
      
      responseText += foldersList.join('\n\n');
    } else {
      responseText += `**Child Folders:** None found in ${path}`;
    }
    
    // Add pagination info if available
    if (result.cursor) {
      responseText += `\n\n**Pagination Info:**\nCursor for next page: ${result.cursor}`;
    }
    
    return {
      content: [{ type: "text", text: responseText }]
    };
  }

  async listContentFragments(args = {}) {
    const params = new URLSearchParams();
    
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });

    const queryString = params.toString();
    const url = `${AEM_CONFIG.getUrl('contentFragments')}${queryString ? '?' + queryString : ''}`;
    
    const result = await this.makeAEMRequest(url);
    
    if (!result.items || result.items.length === 0) {
      return {
        content: [{ type: "text", text: "No content fragments found." }]
      };
    }

    const fragmentsList = result.items.map(fragment => {
      const created = fragment.created ? `${fragment.created.at} by ${fragment.created.by}` : 'Unknown';
      const modified = fragment.modified ? `${fragment.modified.at} by ${fragment.modified.by}` : 'Unknown';
      
      return `**${fragment.title || 'Untitled'}**
  - Path: ${fragment.path}
  - ID: ${fragment.id}
  - Status: ${fragment.status || 'Unknown'}
  - Model: ${fragment.model?.title || 'No model'}
  - Created: ${created}
  - Modified: ${modified}
  - Description: ${fragment.description || 'No description'}`;
    });
    
    let responseText = `AEM Content Fragments (${result.items.length}):\n\n${fragmentsList.join('\n\n')}`;
    
    if (result.cursor) {
      responseText += `\n\n**Pagination Info:**\nCursor for next page: ${result.cursor}`;
    }
    
    return {
      content: [{ type: "text", text: responseText }]
    };
  }

  async importAssetsFromUrl(args = {}) {
    // Validate required parameters
    if (!args.folder || !args.files || !Array.isArray(args.files) || args.files.length === 0) {
      throw new Error('Missing required parameters: folder and files array are required');
    }

    // Validate each file
    args.files.forEach((file, index) => {
      if (!file.fileName || !file.url) {
        throw new Error(`File at index ${index} is missing required properties: fileName and url`);
      }
      if (file.url.length < 10) {
        throw new Error(`File at index ${index} has invalid URL: must be at least 10 characters`);
      }
    });

    const requestBody = {
      folder: args.folder,
      files: args.files
    };

    if (args.sourceName) requestBody.sourceName = args.sourceName;

    const result = await this.makeAEMRequest(AEM_CONFIG.getUrl('assetsImport'), {
      method: 'POST',
      data: requestBody
    });

    let responseText = `**Asset Import Request Submitted Successfully**\n\n`;
    
    if (result.jobId) responseText += `Job ID: ${result.jobId}\n`;
    if (result.status) responseText += `Status: ${result.status}\n`;
    
    responseText += `Files to import: ${args.files.length}\n`;
    responseText += `Target folder: ${args.folder}\n\n`;
    
    responseText += `**Files:**\n`;
    args.files.forEach((file, index) => {
      responseText += `${index + 1}. ${file.fileName}\n   URL: ${file.url}\n`;
      if (file.mimeType) responseText += `   Type: ${file.mimeType}\n`;
      if (file.fileSize) responseText += `   Size: ${file.fileSize} bytes\n`;
      responseText += '\n';
    });

    if (result.message) responseText += `Message: ${result.message}\n`;

    return {
      content: [{ type: "text", text: responseText }]
    };
  }

  async createContentFragment(args = {}) {
    // Validate required parameters
    if (!args.title) {
      throw new Error('Missing required parameter: title is required');
    }
    if (!args.modelId) {
      throw new Error('Missing required parameter: modelId is required');
    }
    if (!args.parentPath) {
      throw new Error('Missing required parameter: parentPath is required');
    }

    // Prepare the request body
    const requestBody = {
      title: args.title,
      modelId: args.modelId,
      parentPath: args.parentPath
    };

    // Add optional parameters
    if (args.description) {
      requestBody.description = args.description;
    }
    if (args.name) {
      requestBody.name = args.name;
    }

    // Process fields if provided
    if (args.fields && Array.isArray(args.fields)) {
      // Validate fields
      args.fields.forEach((field, index) => {
        if (!field.name || !field.type) {
          throw new Error(`Field at index ${index} is missing required properties: name and type`);
        }
        
        // Validate field type
        const validTypes = [
          "text", "long-text", "number", "float-number", 
          "date-time", "date", "time", "boolean", 
          "enumeration", "tag", "content-fragment", 
          "content-reference", "json"
        ];
        
        if (!validTypes.includes(field.type)) {
          throw new Error(`Field at index ${index} has invalid type: ${field.type}. Valid types are: ${validTypes.join(', ')}`);
        }
      });

      requestBody.fields = args.fields.map(field => {
        const processedField = {
          name: field.name,
          type: field.type
        };

        if (field.values !== undefined) {
          // Ensure values is always an array as expected by the API
          if (Array.isArray(field.values)) {
            processedField.values = field.values;
          } else {
            // Convert single value to array
            processedField.values = [field.values];
          }
        }
        if (field.multiple !== undefined) {
          processedField.multiple = field.multiple;
        }
        if (field.locked !== undefined) {
          processedField.locked = field.locked;
        }

        return processedField;
      });
    }

    try {
      const result = await this.makeAEMRequest(AEM_CONFIG.getUrl('createContentFragment'), {
        method: 'POST',
        data: requestBody
      });

      let responseText = `**Content Fragment Created Successfully**\n\n`;
      
      if (result.id) responseText += `ID: ${result.id}\n`;
      if (result.path) responseText += `Path: ${result.path}\n`;
      if (result.title) responseText += `Title: ${result.title}\n`;
      if (result.status) responseText += `Status: ${result.status}\n`;
      if (result.model) responseText += `Model: ${result.model.title || result.model.id}\n`;
      
      responseText += `Parent Path: ${args.parentPath}\n`;
      
      if (args.fields && args.fields.length > 0) {
        responseText += `\n**Fields Configured (${args.fields.length}):**\n`;
        args.fields.forEach((field, index) => {
          responseText += `${index + 1}. **${field.name}** (${field.type})\n`;
          if (field.values !== undefined) {
            const displayValue = Array.isArray(field.values) ? field.values : [field.values];
            responseText += `   Values: [${displayValue.map(v => JSON.stringify(v)).join(', ')}]\n`;
          }
          if (field.multiple) responseText += `   Multiple values: Yes\n`;
          if (field.locked) responseText += `   Locked: Yes\n`;
        });
      }

      // Include creation details if available
      if (result.created) {
        responseText += `\n**Creation Details:**\n`;
        responseText += `Created: ${result.created.at || 'Unknown time'}`;
        if (result.created.by) responseText += ` by ${result.created.by}`;
        responseText += '\n';
      }

      if (result.message) {
        responseText += `\n**Message:** ${result.message}`;
      }

      return {
        content: [{ type: "text", text: responseText }]
      };

    } catch (error) {
      throw new Error(`Failed to create content fragment: ${error.message}`);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("AEM MCP server started");
  }
}

// Server startup with test
const server = new AEMMCPServer();
server.start().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});