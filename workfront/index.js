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
  'WORKFRONT_BASE_URL',
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
const WORKFRONT_CONFIG = {
  baseUrl: process.env.WORKFRONT_BASE_URL,
  bearerToken: null, 
  imsConfig: {
    tokenUrl: process.env.ADOBE_IMS_TOKEN_URL || "https://ims-na1.adobelogin.com/ims/token/v3",
    clientId: process.env.ADOBE_IMS_CLIENT_ID,
    clientSecret: process.env.ADOBE_IMS_CLIENT_SECRET,
    scope: process.env.ADOBE_IMS_SCOPES || "openid,AdobeID,session,additional_info.projectedProductContext,profile,read_organizations,additional_info.roles"
  }
};

class WorkfrontMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "workfront-mcp-server",
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

  async getBearerToken() {
    const { tokenUrl, clientId, clientSecret, scope } = WORKFRONT_CONFIG.imsConfig;
    
    const formData = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Adobe IMS authentication error: ${response.status} - ${errorData}`);
      }

      const data = await response.json();

      if (!data.access_token) {
        throw new Error('No access_token received from Adobe IMS');
      }

      WORKFRONT_CONFIG.bearerToken = data.access_token;
      
      console.error(`Token retrieved successfully. Expires in ${data.expires_in} seconds`);
      
      return data.access_token;
    } catch (error) {
      throw new Error(`Token retrieval error: ${error.message}`);
    }
  }

  async ensureValidToken() {
    if (!WORKFRONT_CONFIG.bearerToken) {
      await this.getBearerToken();
    }
    return WORKFRONT_CONFIG.bearerToken;
  }

  async makeWorkfrontRequest(endpoint, options = {}) {
    await this.ensureValidToken();
    
    const url = `${WORKFRONT_CONFIG.baseUrl}${endpoint}`;
    
    const requestOptions = {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${WORKFRONT_CONFIG.bearerToken}`,
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, requestOptions);

      if (response.status === 401) {
        // Token expired, try to renew it once
        console.error("Token expired, attempting renewal...");
        await this.getBearerToken();
        
        // Update authorization header and retry
        requestOptions.headers['Authorization'] = `Bearer ${WORKFRONT_CONFIG.bearerToken}`;
        const retryResponse = await fetch(url, requestOptions);
        
        if (!retryResponse.ok) {
          const errorData = await retryResponse.text();
          throw new Error(`Workfront API error after token renewal: ${retryResponse.status} - ${errorData}`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Workfront API error: ${response.status} - ${errorData}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Workfront request error: ${error.message}`);
    }
  }

  setupHandlers() {
    // Tools: retrieve project names, portfolios, tasks, templates, users and create new project/task/predecessors
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [
        {
          name: "get_project_names",
          description: "Retrieves the list of Workfront project names",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of projects to return",
                default: 50
              },
              first: {
                type: "number",
                description: "Offset for pagination (0-based index)",
                default: 0
              }
            }
          }
        },
        {
          name: "get_portfolio_names",
          description: "Retrieves the list of Workfront portfolio names",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of portfolios to return",
                default: 100
              },
              first: {
                type: "number",
                description: "Offset for pagination (0-based index)",
                default: 0
              }
            }
          }
        },
        {
          name: "get_task_names",
          description: "Retrieves the list of Workfront task names and IDs",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of tasks to return",
                default: 50
              },
              projectID: {
                type: "string",
                description: "Filter tasks by specific project ID (mandatory)"
              }
            }
          }
        },
        {
          name: "get_template_names",
          description: "Retrieves the list of Workfront template names and IDs",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of templates to return",
                default: 50
              },
              first: {
                type: "number",
                description: "Offset for pagination (0-based index)",
                default: 0
              }
            }
          }
        },
        {
          name: "get_users",
          description: "Retrieves the list of Workfront users",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of users to return",
                default: 50
              },
              isActive: {
                type: "boolean",
                description: "Filter by active users only (true/false). If not specified, returns all users"
              },
              first: {
                type: "number",
                description: "Offset for pagination (0-based index)",
                default: 0
              }
            }
          }
        },
        {
          name: "create_project",
          description: "Creates a new project in Workfront",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Project name",
                default: "Sample Project"
              },
              description: {
                type: "string",
                description: "Sample description",
                default: "Sample project created via API"
              },
              status: {
                type: "string",
                description: "Project status (PLN=Planning, CUR=Current, etc.)",
                default: "PLN"
              },
              priority: {
                type: "number",
                description: "Project priority (1=Low, 2=Normal, 3=High, 4=Urgent)",
                default: 2
              },
              plannedStartDate: {
                type: "string",
                description: "Planned start date (ISO format: YYYY-MM-DDTHH:mm:ss:sss-ZZZZ)",
                default: "2025-08-20T09:00:00:000-0000"
              },
              portfolioID: {
                type: "string",
                description: "ID of the portfolio to associate with the project (optional)"
              },
              ownerID: {
                type: "string",
                description: "ID of the user to assign as project owner (optional)"
              },
              templateID: {
                type: "string",
                description: "ID of the template to use for creating the project (optional)"
              },
              additionalParams: {
                type: "object",
                description: "Additional parameters to include in the project creation (e.g., {'DE:Division': 'Marketing', 'DE:Budget': '50000'})",
                additionalProperties: true
              }
            },
            required: ["name"]
          }
        },
        {
          name: "create_task",
          description: "Creates a new task in Workfront",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Task name",
                default: "Sample Task"
              },
              description: {
                type: "string",
                description: "Task description",
                default: "Sample task created via API"
              },
              projectID: {
                type: "string",
                description: "ID of the project to associate with the task",
                required: true
              },
              isDurationLocked: {
                type: "boolean",
                description: "Whether duration is locked",
                default: true
              },
              duration: {
                type: "number",
                description: "Duration value",
                default: 1
              },
              durationUnit: {
                type: "string",
                description: "Duration unit (D=Days, H=Hours, W=Weeks, M=Minutes)",
                default: "D"
              },
              isWorkRequiredLocked: {
                type: "boolean",
                description: "Whether work required is locked",
                default: true
              },
              workUnit: {
                type: "string",
                description: "Work unit (H=Hours, D=Days)",
                default: "H"
              },
              work: {
                type: "number",
                description: "Work hours required",
                default: 8
              },
              percentComplete: {
                type: "number",
                description: "Percent complete (0-100)",
                default: 0
              },
              priority: {
                type: "number",
                description: "Task priority (1=Low, 2=Normal, 3=High, 4=Urgent)",
                default: 2
              },
              status: {
                type: "string",
                description: "Task status (NEW=New, INP=In Progress, CPL=Complete, etc.)",
                default: "NEW"
              }
            },
            required: ["name", "projectID"]
          }
        },
        {
          name: "create_task_predecessor",
          description: "Creates predecessor relationships between tasks in Workfront",
          inputSchema: {
            type: "object",
            properties: {
              taskID: {
                type: "string",
                description: "ID of the task that will have predecessors",
                required: true
              },
              predecessorExpression: {
                type: "string",
                description: "Predecessor expression (e.g., '1', '2fs+3d', '1,2fs+1d' for multiple predecessors). Format: taskPosition[dependencyType][+lag]. DependencyTypes: fs=finish-start(default), ss=start-start, ff=finish-finish, sf=start-finish. Lag examples: +2d, +1w, +4h",
                required: true
              }
            },
            required: ["taskID", "predecessorExpression"]
          }
        }
      ];

      return { tools };
    });

    // Execution handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "get_project_names") {
          return await this.getProjectNames(args);
        } else if (name === "get_portfolio_names") {
          return await this.getPortfolioNames(args);
        } else if (name === "get_task_names") {
          return await this.getTaskNames(args);
        } else if (name === "get_template_names") {
          return await this.getTemplateNames(args);
        } else if (name === "get_users") {
          return await this.getUsers(args);
        } else if (name === "create_project") {
          return await this.createProject(args);
        } else if (name === "create_task") {
          return await this.createTask(args);
        } else if (name === "create_task_predecessor") {
          return await this.createTaskPredecessor(args);
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async getUsers(args = {}) {
    const limit = args.limit || 50;
    const first = args.first || 0;

    let endpoint = `/user/search?fields=ID,name,emailAddr,isActive&$$LIMIT=${limit}&$$FIRST=${first}`;

    if (args.isActive !== undefined) {
      endpoint += `&isActive=${args.isActive}`;
    }
    
    const result = await this.makeWorkfrontRequest(endpoint);
    
    if (!result.data || result.data.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No users found."
          }
        ]
      };
    }

    const userList = result.data.map(user => {
      const activeStatus = user.isActive ? 'Active' : 'Inactive';
      const email = user.emailAddr || 'No email';
      
      return `- ${user.name} (ID: ${user.ID})\n  Email: ${email}\n  Status: ${activeStatus}`;
    });
    
    const filterText = args.isActive !== undefined 
      ? ` (${args.isActive ? 'Active' : 'Inactive'} users only)` 
      : '';
    
    return {
      content: [
        {
          type: "text",
          text: `Workfront Users${filterText} (${result.data.length}):\n\n${userList.join('\n\n')}`
        }
      ]
    };
  }

  async createTaskPredecessor(args = {}) {
    if (!args.taskID) {
      throw new Error("taskID is required to create task predecessors");
    }
    if (!args.predecessorExpression) {
      throw new Error("predecessorExpression is required to create task predecessors");
    }

    const formData = new URLSearchParams();
    formData.append('predecessorExpression', args.predecessorExpression);

    try {
      const responseData = await this.makeWorkfrontRequest(`/task/${args.taskID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      return {
        content: [
          {
            type: "text",
            text: `Task predecessor relationship created successfully!\n\nTask ID: ${args.taskID}\nPredecessor Expression: ${args.predecessorExpression}\nUpdated: ${responseData.data.name || 'Task updated'}`
          }
        ]
      };

    } catch (error) {
      throw new Error(`Task predecessor creation error: ${error.message}`);
    }
  }

  async createProject(args = {}) {
    const projectData = {
      name: args.name || "Sample Project",
      description: args.description || "Sample project created via API",
      status: args.status || "PLN",
      priority: args.priority || 2,
      plannedStartDate: args.plannedStartDate || new Date().toISOString(),
      portfolioID: args.portfolioID || null,
      ownerID: args.ownerID || null,
      templateID: args.templateID || null
    };

    // Add any additional parameters (like custom fields)
    if (args.additionalParams && typeof args.additionalParams === 'object') {
      Object.entries(args.additionalParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          projectData[key] = value;
        }
      });
    }

    const formData = new URLSearchParams();
    Object.entries(projectData).forEach(([key, value]) => {
      if (value !== null) {
        formData.append(key, value);
      }
    });

    try {
      const responseData = await this.makeWorkfrontRequest('/project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      return {
        content: [
          {
            type: "text",
            text: `Project created successfully!\n\nProject ID: ${responseData.data.ID}\nName: ${responseData.data.name}\nStatus: ${responseData.data.status}\nPlanned Start: ${responseData.data.plannedStartDate}\nPlanned Completion: ${responseData.data.plannedCompletionDate}\nOwner ID: ${responseData.data.ownerID}`
          }
        ]
      };

    } catch (error) {
      throw new Error(`Project creation error: ${error.message}`);
    }
  }

  async createTask(args = {}) {
    if (!args.projectID) {
      throw new Error("projectID is required to create a task");
    }

    const taskData = {
      name: args.name || "Sample Task",
      description: args.description || "Sample task created via API",
      projectID: args.projectID,
      isDurationLocked: args.isDurationLocked !== undefined ? args.isDurationLocked : true,
      duration: args.duration || 1,
      durationUnit: args.durationUnit || "D",
      isWorkRequiredLocked: args.isWorkRequiredLocked !== undefined ? args.isWorkRequiredLocked : true,
      workUnit: args.workUnit || "H",
      work: args.work || 8,
      percentComplete: args.percentComplete || 0,
      priority: args.priority || 2,
      status: args.status || "NEW"
    };

    const formData = new URLSearchParams();
    Object.entries(taskData).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        formData.append(key, value);
      }
    });

    try {
      const responseData = await this.makeWorkfrontRequest('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      return {
        content: [
          {
            type: "text",
            text: `Task created successfully!\n\nTask ID: ${responseData.data.ID}\nName: ${responseData.data.name}\nProject ID: ${responseData.data.projectID}\nStatus: ${responseData.data.status}\nDuration: ${responseData.data.duration} ${responseData.data.durationUnit}\nWork Required: ${responseData.data.work} ${responseData.data.workUnit}\nPercent Complete: ${responseData.data.percentComplete}%`
          }
        ]
      };

    } catch (error) {
      throw new Error(`Task creation error: ${error.message}`);
    }
  }

  async getProjectNames(args = {}) {
    const limit = args.limit || 20;
    const first = args.first || 0;

    const endpoint = `/proj/search?fields=ID,name&$$LIMIT=${limit}&$$FIRST=${first}`;
    const result = await this.makeWorkfrontRequest(endpoint);
    
    if (!result.data || result.data.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No projects found."
          }
        ]
      };
    }

    const projectNames = result.data.map(project => `- ${project.name} (ID: ${project.ID})`);
    
    return {
      content: [
        {
          type: "text",
          text: `Workfront Projects (${result.data.length}):\n\n${projectNames.join('\n')}`
        }
      ]
    };
  }

  async getPortfolioNames(args = {}) {
    const limit = args.limit || 100;
    const first = args.first || 0;

    const endpoint = `/port/search?fields=ID,name&$$LIMIT=${limit}&$$FIRST=${first}`;
    const result = await this.makeWorkfrontRequest(endpoint);
    
    if (!result.data || result.data.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No portfolios found."
          }
        ]
      };
    }

    const portfolioNames = result.data.map(portfolio => `- ${portfolio.name} (ID: ${portfolio.ID})`);
    
    return {
      content: [
        {
          type: "text",
          text: `Workfront Portfolios (${result.data.length}):\n\n${portfolioNames.join('\n')}`
        }
      ]
    };
  }

  async getTaskNames(args = {}) {
    const limit = args.limit || 50;
    let endpoint = `/task/search?fields=ID,name,projectID&$$LIMIT=${limit}`;
    
    if (args.projectID) {
      endpoint += `&projectID=${args.projectID}`;
    }
    
    const result = await this.makeWorkfrontRequest(endpoint);
    
    if (!result.data || result.data.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: args.projectID ? `No tasks found for project ID: ${args.projectID}` : "No tasks found."
          }
        ]
      };
    }

    const taskNames = result.data.map(task => `- ${task.name} (ID: ${task.ID}, Project ID: ${task.projectID})`);
    
    const headerText = args.projectID 
      ? `Tasks for Project ID ${args.projectID} (${result.data.length}):`
      : `Workfront Tasks (${result.data.length}):`;
    
    return {
      content: [
        {
          type: "text",
          text: `${headerText}\n\n${taskNames.join('\n')}`
        }
      ]
    };
  }

  async getTemplateNames(args = {}) {
    const limit = args.limit || 50;
    const first = args.first || 0;

    let endpoint = `/tmpl/search?fields=ID,name,isActive&$$LIMIT=${limit}&$$FIRST=${first}`;
    
    const result = await this.makeWorkfrontRequest(endpoint);
    
    if (!result.data || result.data.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: args.status ? `No templates found` : "No templates found."
          }
        ]
      };
    }

    const templateList = result.data.map(template => {
      const activeStatus = template.isActive ? 'Active' : 'Inactive';
      const status = template.status || 'Unknown';
      
      return `- ${template.name} (ID: ${template.ID})\n  Status: ${status} | ${activeStatus}`;
    });
    
    const filterText = args.status ? ` (Status: ${args.status})` : '';
    
    return {
      content: [
        {
          type: "text",
          text: `Workfront Templates${filterText} (${result.data.length}):\n\n${templateList.join('\n\n')}`
        }
      ]
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Workfront MCP server with task, predecessor, user, and template support started");
    console.error("Adobe IMS configuration:", {
      tokenUrl: WORKFRONT_CONFIG.imsConfig.tokenUrl,
      clientId: WORKFRONT_CONFIG.imsConfig.clientId,
      clientSecretConfigured: !!WORKFRONT_CONFIG.imsConfig.clientSecret
    });
  }
}

// Server startup
const server = new WorkfrontMCPServer();
server.start().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
