# Workfront MCP Server

A Model Context Protocol (MCP) server that provides Claude with the ability to interact with Adobe Workfront. This server enables querying projects, portfolios, tasks, templates, users, and creating new projects and tasks with predecessor relationships.

## Features

### Query Operations
- **Get Project Names**: Retrieve a list of Workfront project names and IDs
- **Get Portfolio Names**: Retrieve a list of Workfront portfolio names and IDs  
- **Get Task Names**: Retrieve task names and IDs, optionally filtered by project
- **Get Template Names**: Retrieve template names and IDs with status information
- **Get Users**: Retrieve user information with filtering by active status

### Create Operations
- **Create Project**: Create new projects with support for templates, portfolios, owners, and custom fields
- **Create Task**: Create new tasks within projects with duration, work requirements, and status settings
- **Create Task Predecessors**: Establish predecessor relationships between tasks with dependency types and lag times

## Prerequisites

- Node.js (v18 or higher)
- Adobe Workfront account with API access
- Adobe IMS (Identity Management System) credentials

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your configuration (see Configuration section)

## Configuration

Create a `.env` file in the project root with the following variables:

```env
# Required Environment Variables
WORKFRONT_BASE_URL=https://your-domain.workfront.com/attask/api/v18.0
ADOBE_IMS_CLIENT_ID=your_client_id
ADOBE_IMS_CLIENT_SECRET=your_client_secret

# Optional Environment Variables
ADOBE_IMS_TOKEN_URL=https://ims-na1.adobelogin.com/ims/token/v3
ADOBE_IMS_SCOPES=openid,AdobeID,session,additional_info.projectedProductContext,profile,read_organizations,additional_info.roles
```

### Required Variables
- `WORKFRONT_BASE_URL`: Your Workfront instance API endpoint
- `ADOBE_IMS_CLIENT_ID`: Adobe IMS client ID for authentication
- `ADOBE_IMS_CLIENT_SECRET`: Adobe IMS client secret for authentication

### Optional Variables
- `ADOBE_IMS_TOKEN_URL`: Adobe IMS token endpoint (defaults to NA1 region)
- `ADOBE_IMS_SCOPES`: OAuth scopes for authentication (has sensible defaults)

## Usage

### Starting the Server

```bash
npm start
# or
node index.js
```

The server uses stdio transport and will log authentication information to stderr.

### Available Tools

#### Query Tools

**get_project_names**
- Retrieves project names and IDs
- Parameters: `limit` (default: 50), `first` (pagination offset, default: 0)

**get_portfolio_names**  
- Retrieves portfolio names and IDs
- Parameters: `limit` (default: 100), `first` (pagination offset, default: 0)

**get_task_names**
- Retrieves task names and IDs
- Parameters: `limit` (default: 50), `projectID` (required for filtering)

**get_template_names**
- Retrieves template names, IDs, and status
- Parameters: `limit` (default: 50), `first` (pagination offset, default: 0)

**get_users**
- Retrieves user information
- Parameters: `limit` (default: 50), `isActive` (boolean filter), `first` (pagination offset, default: 0)

#### Creation Tools

**create_project**
- Creates a new Workfront project
- Parameters:
  - `name` (required): Project name
  - `description`: Project description
  - `status`: Project status (PLN=Planning, CUR=Current, etc.)
  - `priority`: Priority level (1=Low, 2=Normal, 3=High, 4=Urgent)
  - `plannedStartDate`: Start date in ISO format
  - `portfolioID`: ID of associated portfolio
  - `ownerID`: ID of project owner
  - `templateID`: ID of template to use
  - `additionalParams`: Object with custom fields (e.g., `{"DE:Division": "Marketing"}`)

**create_task**
- Creates a new task within a project
- Parameters:
  - `name` (required): Task name
  - `projectID` (required): ID of the parent project
  - `description`: Task description
  - `duration`: Duration value
  - `durationUnit`: Duration unit (D=Days, H=Hours, W=Weeks, M=Minutes)
  - `work`: Work hours required
  - `workUnit`: Work unit (H=Hours, D=Days)
  - `percentComplete`: Completion percentage (0-100)
  - `priority`: Task priority (1-4)
  - `status`: Task status (NEW, INP, CPL, etc.)

**create_task_predecessor**
- Creates predecessor relationships between tasks
- Parameters:
  - `taskID` (required): ID of the dependent task
  - `predecessorExpression` (required): Predecessor expression (e.g., "1", "2fs+3d", "1,2fs+1d")
    - Format: `taskPosition[dependencyType][+lag]`
    - Dependency types: fs=finish-start (default), ss=start-start, ff=finish-finish, sf=start-finish
    - Lag examples: +2d (2 days), +1w (1 week), +4h (4 hours)

## Authentication

The server uses Adobe IMS OAuth 2.0 client credentials flow for authentication. It automatically:
- Retrieves access tokens using your client credentials
- Handles token renewal when tokens expire (401 responses)
- Includes proper Authorization headers in all Workfront API requests

## Error Handling

The server includes comprehensive error handling for:
- Missing environment variables (exits with error on startup)
- Authentication failures (detailed error messages)
- API request failures (includes response status and error details)
- Token expiration (automatic renewal with retry)

## MCP Integration

This server implements the Model Context Protocol and can be used with Claude Desktop or other MCP-compatible clients. Add it to your MCP configuration to enable Workfront integration in your Claude conversations.

### Option 1: Environment Variables (Recommended)
Create a `.env` file in your project directory and configure Claude Desktop:

```json
{
  "mcpServers": {
    "workfront": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/fornacia/Projects/claude-mcp-servers/workfront/index.js"]
    }
  }
}
```

### Option 2: Direct Environment Configuration
You can also pass environment variables directly in the Claude Desktop configuration:

```json
{
  "mcpServers": {
    "workfront": {
      "command": "node",
      "args": [
        "/path/to/workfront-mcp-server/index.js"
      ],
      "env": {
        "WORKFRONT_BASE_URL": "https://your-domain.testdrive.workfront.com/attask/api/v20.0",
        "ADOBE_IMS_CLIENT_ID": "your_client_id",
        "ADOBE_IMS_CLIENT_SECRET": "your_client_secret",
        "ADOBE_IMS_SCOPES": "openid,AdobeID,session,additional_info.projectedProductContext,profile,read_organizations,additional_info.roles"
      }
    }
  }
}
```

**Important Notes:**
- Replace `/opt/homebrew/bin/node` with your actual Node.js path (find it using `which node`)
- Replace `/Users/fornacia/Projects/claude-mcp-servers/workfront/index.js` with the actual path to your server
- Replace the environment variable values with your actual Workfront and Adobe IMS credentials
- Never commit real credentials to version control - use Option 1 with `.env` files for security

## Dependencies

- `@modelcontextprotocol/sdk`: MCP SDK for server implementation
- `dotenv`: Environment variable management

## Version

Current version: 1.0.0

## License

This project is provided as-is for integration with Adobe Workfront systems.