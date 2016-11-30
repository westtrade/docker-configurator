/**
* @Author: Popov Gennadiy
* @Date:   2016-11-25T04:43:34+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-11-30T06:41:05+03:00
*/

import Docker from 'dockerode';
import config from 'config';
import program from 'commander';
import { version } from './package.json';
import { argvReducer } from './src/argv';
import ConfigurationGenerator from './src/generator';
import ContainersWatcherClass from './src/registrator/events';


program
	.version(version)
	.option('-t, --template <path>', 'Configuration template')
	.parse(process.argv);

const { templates } = process.argv.reduce(argvReducer('-t', '--template', 'templates'), {});

// console.log(templates);
// console.log(process.argv);

const socketPath = config.get('socket-path');
const dockerClient = new Docker({ socketPath });
const datastoreSettings = config.get('database');

const watcher = new ContainersWatcherClass({ dockerClient, datastoreSettings });
const generator = new ConfigurationGenerator({ dockerClient, templates, watcher });

generator.on('error', error => console.log(error));

//

// watcher.on('change', async (info) => {
//
// 	let containers = await watcher.find({
// 		'env.VIRTUAL_HOST': {
// 			$exists: true,
// 		},
// 	});
//
// 	console.log(info);
// 	console.log(containers);
// });
