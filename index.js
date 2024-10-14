#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml');
const axios = require('axios');
const { Command } = require('commander');
const { exec } = require('child_process'); // Import exec to execute shell commands

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

// Function to handle HTTP requests (or skip if no endpoint)
async function makeRequest(command, variables, headers, args) {
    const configStore = loadConfigStore();
    const updatedVariables = { ...variables, ...configStore };

    if (command.endpoint) {
        const urlWithVars = replaceVariables(command.endpoint, { ...updatedVariables, ...args });
        const url = urlWithVars.split(' ')[1];
        const method = urlWithVars.split(' ')[0];
        const body = command.body ? JSON.parse(replaceVariables(JSON.stringify(command.body), { ...updatedVariables, ...args })) : {};

        const updatedHeaders = {};
        Object.keys(headers).forEach(key => {
            updatedHeaders[key] = replaceVariables(headers[key], updatedVariables);
        });

        try {
            const response = await axios({
                method: method,
                url: url,
                headers: updatedHeaders,
                data: body
            });

            if (command.response) {
                const responseText = command.response.replace(/\$data\.[a-zA-Z0-9_.-]+/g, (match) => {
                    const propertyPath = match.replace('$data.', '');
                    const value = getNestedProperty(response.data, propertyPath);
                    return formatResponseValue(value);
                });
                const responseUpdatedText = replaceVariables(responseText, { ...updatedVariables, ...args });
                console.log(responseUpdatedText);
            }

            if (command.set) {
                Object.keys(command.set).forEach(key => {
                    const setValue = command.set[key].replace(/\$data\.[a-zA-Z0-9_.-]+/g, (match) => {
                        const propertyPath = match.replace('$data.', '');
                        const value = getNestedProperty(response.data, propertyPath);
                        return value || '';
                    });
                    updatedVariables[key] = replaceVariables(setValue, { ...updatedVariables, ...args });
                });

                saveConfigStore(updatedVariables);
                console.log('Updated configuration saved:', updatedVariables);
            }
        } catch (error) {
            console.error(`Error: ${error.response ? JSON.stringify(error.response.data, null, 2) : error.message}`);
        }
    } else if (command.response) {
        const responseUpdatedText = replaceVariables(command.response, { ...updatedVariables, ...args });
        console.log(responseUpdatedText);
    }

    if (command.execute) {
        exec(command.execute, (err, stdout, stderr) => {
            if (err) {
                console.error(`Execution error: ${stderr}`);
                return;
            }
            console.log(stdout.trim());
        });
    }
}

// Define CLI commands dynamically based on YAML configuration
function setupCLI(config) {
    const program = new Command();
    const registeredParents = {};

    Object.keys(config.commands).forEach(cmd => {
        const commandDetails = config.commands[cmd];

        const commandParts = cmd.split(' ');
        const parentCommandName = commandParts[0];
        const subcommandName = commandParts.slice(1).join(' ');

        const optionalArgs = cmd.match(/\[(.*?)\]/g) || [];
        const mandatoryArgs = cmd.match(/<(.*?)>/g) || [];

        const cleanOptionalArgs = optionalArgs.map(arg => arg.replace(/[\[\]]/g, ''));
        const cleanMandatoryArgs = mandatoryArgs.map(arg => arg.replace(/[<>]/g, ''));

        if (!registeredParents[parentCommandName]) {
            const parentCommand = program.command(parentCommandName);
            parentCommand.description(`Executes ${parentCommandName}`);

            // Add positional arguments (mandatory arguments)
            cleanMandatoryArgs.forEach(arg => {
                parentCommand.argument(`${arg}`, `Mandatory positional argument ${arg}`);
            });

            // Add options (for optional arguments)
            cleanOptionalArgs.forEach(arg => {
                parentCommand.option(`--${arg}`, `Optional argument ${arg}`);
            });

            // Define action for the parent command
            parentCommand.action(async (mandatoryArg, ...args) => {
                const options = parentCommand.opts(); // Collect options like --optional
                const parsedArgs = { mandatory: mandatoryArg, ...options }; // Merge mandatory positional and optional args

                await makeRequest(commandDetails, config.variables, config.headers, parsedArgs);
            });

            registeredParents[parentCommandName] = parentCommand;
        }

        if (subcommandName) {
            const parentCommand = registeredParents[parentCommandName];
            const subcommand = parentCommand.command(subcommandName).description(`Executes ${cmd}`);

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
