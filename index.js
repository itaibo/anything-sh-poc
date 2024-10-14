#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml');
const axios = require('axios');
const { Command } = require('commander');

// Define the path for the config storage file (JSON format)
const configStorePath = path.join(os.homedir(), 'anything_sh_config_store.json');

// Load the config from the file, or initialize an empty object
function loadConfigStore() {
    if (fs.existsSync(configStorePath)) {
        const fileData = fs.readFileSync(configStorePath, 'utf8');
        return JSON.parse(fileData);
    }
    return {};
}

// Save the config to the file
function saveConfigStore(config) {
    fs.writeFileSync(configStorePath, JSON.stringify(config, null, 2));
}

// Utility function to access deep properties using dot notation
function getNestedProperty(obj, path) {
    return path.split('.').reduce((acc, part) => {
        // Use bracket notation for keys with special characters like hyphens
        return acc && acc[part] !== undefined ? acc[part] : acc[part.replace(/-/g, '')];
    }, obj);
}

// Helper to replace variables in the request body, URL, or headers
function replaceVariables(str, variables) {
    return str.replace(/\$([a-zA-Z_]+)/g, (_, name) => variables[name] || '');
}

// Helper to format response values
function formatResponseValue(value) {
    if (typeof value === 'string') {
        return value.length > 50 ? `${value.substring(0, 50)}...` : value;  // Trim long strings for display
    }
    return value !== undefined ? value : 'undefined';  // Handle undefined values
}

// Function to handle HTTP requests
async function makeRequest(command, variables, headers, args) {
    // Load the saved config (tokens, etc.)
    const configStore = loadConfigStore();

    // Merge variables with stored config (stored tokens or variables)
    const updatedVariables = { ...variables, ...configStore };

    // Replace variables in the URL and extract method
    const urlWithVars = replaceVariables(command.endpoint, { ...updatedVariables, ...args });
    const url = urlWithVars.split(' ')[1];
    const method = urlWithVars.split(' ')[0];
    const body = command.body ? JSON.parse(replaceVariables(JSON.stringify(command.body), { ...updatedVariables, ...args })) : {};

    // Replace variables in headers
    const updatedHeaders = {};
    Object.keys(headers).forEach(key => {
        updatedHeaders[key] = replaceVariables(headers[key], updatedVariables);
    });

    console.log(updatedHeaders)
    try {
        // Send the HTTP request
        const response = await axios({
            method: method,
            url: url,
            headers: updatedHeaders,
            data: body
        });

        // Handle the response and replace dynamic placeholders
        if (command.response) {
            const responseText = command.response.replace(/\$data\.[a-zA-Z0-9_.-]+/g, (match) => {
                const propertyPath = match.replace('$data.', '');
                const value = getNestedProperty(response.data, propertyPath);
                return formatResponseValue(value); // Post-process the value before returning
            });
            console.log(responseText);
        }

        // Handle setting variables (e.g., tokens) from the response and save to the file
        if (command.set) {
            Object.keys(command.set).forEach(key => {
                const setValue = command.set[key].replace(/\$data\.[a-zA-Z0-9_.-]+/g, (match) => {
                    const propertyPath = match.replace('$data.', '');
                    const value = getNestedProperty(response.data, propertyPath);
                    return value || '';
                });
                
                // Save the set value in the config store (which holds tokens or other variables)
                updatedVariables[key] = setValue;
            });

            // Save updated config back to the file
            saveConfigStore(updatedVariables);

            console.log('Updated configuration saved:', updatedVariables);
        }
    } catch (error) {
        console.error(`Error: ${error.response ? JSON.stringify(error.response.data, null, 2) : error.message}`);
    }
}

// Define CLI commands dynamically based on YAML configuration
function setupCLI(config) {
    const program = new Command();

    // A map to store registered parent commands to prevent duplicates
    const registeredParents = {};

    // Iterate over each command in the YAML file
    Object.keys(config.commands).forEach(cmd => {
        const commandDetails = config.commands[cmd];

        // Split command into parent and subcommands
        const commandParts = cmd.split(' ');
        const parentCommandName = commandParts[0]; // e.g., "get"
        const subcommandName = commandParts.slice(1).join(' '); // Get subcommand part if it exists (e.g., "something")

        // Match optional ([option]) and mandatory (<option>) arguments
        const optionalArgs = cmd.match(/\[(.*?)\]/g) || [];
        const mandatoryArgs = cmd.match(/<(.*?)>/g) || [];

        // Remove brackets from arguments
        const cleanOptionalArgs = optionalArgs.map(arg => arg.replace(/[\[\]]/g, ''));
        const cleanMandatoryArgs = mandatoryArgs.map(arg => arg.replace(/[<>]/g, ''));

        // Register parent command (if not already registered)
        if (!registeredParents[parentCommandName]) {
            const parentCommand = program.command(parentCommandName);
            parentCommand.description(`Executes ${parentCommandName}`);

            // Register both mandatory and optional arguments for parent command
            cleanMandatoryArgs.forEach(arg => {
                parentCommand.argument(`<${arg}>`); // Mandatory arguments
            });
            cleanOptionalArgs.forEach(arg => {
                parentCommand.argument(`[${arg}]`); // Optional arguments
            });

            // Define action for the parent command
            parentCommand.action(async (...args) => {
                const parsedArgs = {};
                [...cleanMandatoryArgs, ...cleanOptionalArgs].forEach((arg, index) => {
                    if (args[index]) {
                        parsedArgs[arg] = args[index];
                    }
                });
                await makeRequest(commandDetails, config.variables, config.headers, parsedArgs);
            });

            // Mark the parent as registered
            registeredParents[parentCommandName] = parentCommand;
        }

        // Handle subcommands (e.g., "get something")
        if (subcommandName) {
            const parentCommand = registeredParents[parentCommandName];

            // Register the subcommand under the parent
            const subcommand = parentCommand.command(subcommandName).description(`Executes ${cmd}`);
          
            // Register subcommand action
            subcommand.action(async () => {
                await makeRequest(commandDetails, config.variables, config.headers, {});
            });
        }
    });

    program.parse(process.argv);
}

// Load and parse the YAML file
function loadConfig(filePath) {
    const file = fs.readFileSync(path.resolve(filePath), 'utf8');
    return yaml.parse(file);
}

// Main function to execute
(async () => {
    const config = loadConfig('config.yaml'); // Assuming your YAML file is named `config.yaml`
    setupCLI(config);
})();
