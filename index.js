#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const axios = require('axios');
const { Command } = require('commander');

// Load and parse the YAML file
function loadConfig(filePath) {
    const file = fs.readFileSync(path.resolve(filePath), 'utf8');
    return yaml.parse(file);
}

// Utility function to access deep properties using dot notation, with handling for hyphens
function getNestedProperty(obj, path) {
    return path.split('.').reduce((acc, part) => {
        // Check if the part contains a hyphen, and use bracket notation in such cases
        return acc && acc[part] !== undefined ? acc[part] : acc && acc[part.replace(/-/, '')];
    }, obj);
}

// Function to handle HTTP requests
async function makeRequest(command, variables, headers, args) {
    // Replace variables in the URL and extract method
    const urlWithVars = replaceVariables(command.endpoint, { ...variables, ...args });
    const url = urlWithVars.split(' ')[1];
    const method = urlWithVars.split(' ')[0];
    const body = command.body ? JSON.parse(replaceVariables(JSON.stringify(command.body), { ...variables, ...args })) : {};

    try {
        // Send the HTTP request
        const response = await axios({
            method: method,
            url: url,
            headers: headers,
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

        // Handle setting headers from the response
        if (command.set) {
            Object.keys(command.set).forEach(key => {
                const setValue = command.set[key].replace(/\$data\.[a-zA-Z0-9_.-]+/g, (match) => {
                    const propertyPath = match.replace('$data.', '');
                    const value = getNestedProperty(response.data, propertyPath);
                    return value || '';
                });
                headers[key] = setValue;
            });
        }
    } catch (error) {
        console.error(`Error: ${error.response ? JSON.stringify(error.response.data, null, 2) : error.message}`);
    }
}

// Helper to format response values, e.g., trimming long headers or handling undefined values
function formatResponseValue(value) {
    if (typeof value === 'string') {
        return value.length > 50 ? `${value.substring(0, 50)}...` : value;  // Trim long strings for display
    }
    return value !== undefined ? value : 'undefined';  // Handle undefined values
}

// Helper to replace variables in the request body and URL
function replaceVariables(str, variables) {
    return str.replace(/\$([a-zA-Z_]+)/g, (_, name) => variables[name] || '');
}

// Define CLI commands
function setupCLI(config) {
    const program = new Command();

    Object.keys(config.commands).forEach(cmd => {
        const commandDetails = config.commands[cmd];

        // Define positional arguments from the YAML (like user and password)
        const argsList = cmd.match(/\[(.*?)\]/g) || [];
        const cleanArgsList = argsList.map(arg => arg.replace(/[\[\]?]/g, ''));

        const cliCommand = program.command(cmd.split(' ')[0]);

        cliCommand.description(`Execute ${cmd}`).action(async (...args) => {
            const parsedArgs = {};
            cleanArgsList.forEach((arg, index) => {
                if (args[index]) {
                    parsedArgs[arg] = args[index];
                }
            });
            await makeRequest(commandDetails, config.variables, config.headers, parsedArgs);
        });

        cleanArgsList.forEach(arg => {
            cliCommand.argument(`<${arg}>`);
        });
    });

    program.parse(process.argv);
}

// Main function to execute
(async () => {
    const config = loadConfig('config.yaml');
    setupCLI(config);
})();
