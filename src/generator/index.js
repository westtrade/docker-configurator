/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-26T11:27:20+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-11-29T14:18:03+03:00
*/
import EventEmmiter from 'events';
import Dust from 'dustjs-linkedin';
import MongoQS from 'mongo-querystring';
import fs from 'fs';
import createDebugLog from 'debug';
import chokidar from 'chokidar';

import qs from 'qs';
import { resolve } from 'path';
import { createHash } from 'crypto';
const debug = createDebugLog('docker-gen-container-generator');

const readFile = (filePath, encode = 'UTF-8') => {
	return new Promise((resolve, reject) => {
		fs.readFile(filePath, encode, (error, fileContent) => {
			if (error) {
				return reject(error);
			}

			resolve(fileContent);
		});
	});
}

const writeFile = (filePath, fileContent) => {
	return new Promise((resolve, reject) => {
		fs.writeFile(filePath, fileContent, (error) => {
			if (error) {
				return reject(error);
			}

			resolve();
		});
	});
}

const restartContainer = (dockerClient, containerId) => {
	return new Promise((resolve, reject) => {
		dockerClient.getContainer(containerId).restart((error, result) => {
			if (error) {
				return reject(error);
			}

			resolve(result);
		})
	});
};


const privateProperties = Symbol('Private options property');
const containersChangeHandler = Symbol('Container changed event handler');
const configurationGenerator = Symbol('Generate new configuration');
const ctxKey = Symbol('Context private key');

export default class ConfigurationGenerator extends EventEmmiter {

	constructor({ dockerClient, templates, watcher }) {

		if (typeof templates === 'string') {
			templates = [templates];
		}

		templates = templates.map(templateString => templateString.split(':'));

		super();

		this[privateProperties] = {
			templates: templates || [],
			watcher,
			dockerClient,
			containersHash: null,
			templatesCache: [],
		};
// chokidar
		this[ctxKey] = {
			async containers(chunk, context, bodies, params) {

				let { query } = Object.assign({}, { query: '' }, params);
				const mongoQs = new MongoQS();

				try {
					query = qs.parse(query);
					query = mongoQs.parse(query);
				} catch (e) {
					console.log(e);
					query = {};
				}

				return watcher.find(query);
			},

			json(chunk, context, bodies) {
				const { stack: { head } } = context;
				const currentChunk = JSON.stringify(head, null, 2);
				chunk.write(currentChunk);
				return true;
			},
		};

		watcher.on('change', async (...args) => this[containersChangeHandler](...args));

		const watchedFilesList = templates.map(([templatePath]) => resolve(templatePath));
		const watchedFiles = chokidar.watch(watchedFilesList, { persistent: true });
		watchedFiles.on('change', (...args) => this[containersChangeHandler](...args));
		// this.on('update', containers => this[configurationGenerator](containers));
	}

	renderTemplate (templateContent = '') {

		let templateID = createHash('md5').update(templateContent).digest("hex");
		if (!this[privateProperties].templatesCache.includes(templateID)) {
			let compiledTemplate = Dust.compile(templateContent, templateID);
			Dust.loadSource(compiledTemplate);
			this[privateProperties].templatesCache.push(templateID);
		}

		return new Promise((resolve, reject) => {
			Dust.render(templateID, this[ctxKey], (error, outputString) => {
				return error ? reject(error) : resolve(outputString);
			});
		});
	}

	async [containersChangeHandler](...args) {

		console.log(...args);

		let me = this;
		let templatesCount = this[privateProperties].templates.length;
		while (templatesCount--) {

			const currentTemplate = this[privateProperties].templates[templatesCount];
			const [templatePath, destinationPath, dockerService] = currentTemplate;

			const templateSource = await readFile(templatePath);
			const configContent = await this.renderTemplate(templateSource);
			if (typeof destinationPath === 'string') {
				await writeFile(destinationPath, configContent);
			}

			if (this[privateProperties].dockerClient && dockerService) {
				console.log('Restart container: %s;', dockerService);
				let result = await restartContainer(this[privateProperties].dockerClient, dockerService);
				console.log(result);
			}

		}
	}
}
