/**
* @Author: Popov Gennadiy
* @Date:   2016-11-25T04:43:34+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-01T06:19:12+03:00
*/

import config from 'config';
import createDebugLog from 'debug';
import Docker from 'dockerode';
import program from 'commander';

import { argvReducer } from './src/argv';
import ConfigurationGenerator from './src/generator';
import ContainersWatcherClass from './src/registrator';
import { version, name } from './package.json';

const debug = createDebugLog(`${name}-entry`);


program
	.version(version)
	.option('-t, --template <path>', 'Configuration template')
	.parse(process.argv);

const { templates } = process.argv.reduce(argvReducer('-t', '--template', 'templates'), {});
const socketPath = config.get('socket-path');
const dockerClient = new Docker({ socketPath });
const datastoreSettings = config.get('database');

const watcher = new ContainersWatcherClass({ dockerClient, datastoreSettings });
const generator = new ConfigurationGenerator({ dockerClient, templates, watcher });

generator.on('error', error => debug(error));
