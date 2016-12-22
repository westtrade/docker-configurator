/**
* @Author: Popov Gennadiy
* @Date:   2016-11-25T04:43:34+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-22T05:26:24+03:00
*/

'use strict';

import config from 'config';
import createDebugLog from 'debug';
import Docker from 'dockerode';

import { existsSync } from 'fs';
import assert from 'assert';

import { tryCatch } from './src/utils';
import argvReducer from './src/argv';
import ConfigurationGenerator from './src/generator';
import ContainersWatcherClass from './src/registrator';
import { name } from './package.json';

const debug = createDebugLog(`${name}-entry`);

const socketPath = config.get('socket-path');
const datastoreSettings = config.get('database');

let templates = config.get('templates');
const { templates: templatesCLI } = process.argv.reduce(argvReducer('-t', '--template', 'templates'), {});

if (templatesCLI && templatesCLI.length) {

	if (templates.length) {
		debug('Templates list overridden by command line parameter');
	}

	templates = templatesCLI;
}

assert(templates && templates.length, 'Templates list is empty');
assert(existsSync(socketPath), `Docker socket on path ${socketPath} doesn't exists.`);

const dockerClient = new Docker({ socketPath });
const watcher = new ContainersWatcherClass({ dockerClient, datastoreSettings });
const generator = new ConfigurationGenerator({ dockerClient, templates, watcher });

generator.on('error', error => debug(error));
