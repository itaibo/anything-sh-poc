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

// Function to handle HTTP requests
async function makeRequest(command, variables, headers, args) {
    let url = command.endpoint.replace(/\$BASE_URL/g, variables.BASE_URL).split(' ')[1];
    let method = command.endpoint.split(' ')[0];

    // Prepare request body if it exists
    let body = command.body ? JSON.parse(replaceVariables(JSON.stringify(command.body), { ...variables, ...args })) : {};

    try {
        const response = await axios({
            method: method,
            url: url,
            headers: headers,
            data: body
        });

        // Handle response and setting new variables
        if (command.response) {
            let responseKey = command.response.split('$data.')[1];
            let responseData = response.data[responseKey];
            console.log(`Response: ${responseData}`);
        }

        if (command.set) {
            for (let key in command.set) {
                let value = command.set[key].replace('$data.token', response.data.token);
                headers[key] = value;
            }
        }
    } catch (error) {
        console.error(`Error during request: ${error.response ? error.response.data : error.message}`);
    }
}

// Helper to replace variables in the request body
function replaceVariables(str, variables) {
    return str.replace(/\$([a-zA-Z_]+)/g, (_, name) => variables[name] || '');
}

// Define CLI commands
function setupCLI(config) {
    const program = new Command();
    
    Object.keys(config.commands).forEach(cmd => {
        const commandDetails = config.commands[cmd];

        // Define positional arguments from the YAML (like user and password)
        let argsList = cmd.match(/\[(.*?)\]/g) || [];
        argsList = argsList.map(arg => arg.replace(/[\[\]?]/g, '')); // Clean up optional flag symbols

        const cliCommand = program.command(cmd.split(' ')[0]);

        cliCommand
            .description(`Execute ${cmd}`)
            .action(async (...args) => {
                let parsedArgs = {};
                argsList.forEach((arg, index) => {
                    if (args[index]) {
                        parsedArgs[arg] = args[index];
                    }
                });
                await makeRequest(commandDetails, config.variables, config.headers, parsedArgs);
            });

        // Set positional arguments (accepting optional args with ?)
        argsList.forEach(arg => {
            cliCommand.argument(`<${arg}>`);
        });
    });
    
    program.parse(process.argv);
}

// Main function to execute
(async () => {
    const config = loadConfig('config.yaml'); // Path to your YAML config
    setupCLI(config);
})();
