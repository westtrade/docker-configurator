/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-26T11:27:20+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-01T08:08:57+03:00
*/

import createDebugLog from 'debug';
import EventEmmiter from 'events';
import Dust from 'dustjs-linkedin';
import MongoQS from 'mongo-querystring';
import chokidar from 'chokidar';
import fs from 'fs';
import qs from 'qs';
import { resolve as pathResolve } from 'path';
import { createHash } from 'crypto';

import { name } from '../../package.json';
import { tryCatch } from '../utils';

const debug = createDebugLog(`${name}-generator`);

const readFile = (filePath, encode = 'UTF-8') => new Promise((resolve, reject) => {
	fs.readFile(filePath, encode, (error, fileContent) => {
		if (error) {
			return reject(error);
		}

		return resolve(fileContent);
	});
});


const writeFile = (filePath, fileContent) => new Promise((resolve, reject) => {
	fs.writeFile(filePath, fileContent, (error) => {
		if (error) {
			return reject(error);
		}

		return resolve();
	});
});


const restartContainer = (dockerClient, containerId) => new Promise((resolve, reject) => {
	dockerClient.getContainer(containerId).restart((error, result) => {
		if (error) {
			return reject(error);
		}

		return resolve(result);
	});
});


const getFileMD5 = filePath => new Promise((resolve) => {
	fs.stat(filePath, (err) => {
		if (err) {
			return resolve(null);
		}

		return fs.readFile(filePath, 'utf-8', (foldedError, templateContent) => {
			if (foldedError) {
				return resolve(null);
			}

			const templateHash = createHash('md5').update(templateContent).digest('hex');
			return resolve(templateHash);
		});
	});
});


const privateProperties = Symbol('Private options property');
const containersChangeHandler = Symbol('Container changed event handler');
// const configurationGenerator = Symbol('Generate new configuration');
const ctxKey = Symbol('Context private key');

export default class ConfigurationGenerator extends EventEmmiter {

	constructor({ dockerClient, templates, watcher }) {

		templates = templates || [];

		if (typeof templates === 'string') {
			templates = [templates];
		}

		templates = templates.map(templateString => templateString.split(':'));

		debug('Configuration generator created, with %s template%s', templates.length, templates.length > 1 ? '\'s' : '');

		super();

		this[privateProperties] = {
			templates: templates || [],
			watcher,
			dockerClient,
			templatesHash: {},
			templatesCache: [],
			next: Promise.resolve(),
		};

		const me = this;
		this[ctxKey] = {

			async containers(chunk, context, bodies, params) {

				let { query } = Object.assign({}, { query: '' }, params);
				const mongoQs = new MongoQS();

				const [queryError, parsedQuery] = tryCatch(() => mongoQs.parse(qs.parse(query)));

				if (queryError) {
					me.emit('error', queryError);
					query = {};
				} else {
					query = parsedQuery;
				}

				return watcher.find(query);
			},

			json(chunk, context) {

				const [jsonError, resultString] = tryCatch(() => {
					const { stack: { head } } = context;
					return JSON.stringify(head, null, 2);
				});

				if (jsonError) {
					me.emit('error', jsonError);
				} else {
					chunk.write(resultString);
				}

				return true;
			},
		};

		watcher.on('error', watcherError => this.emit('error', watcherError));
		watcher.on('change', async (...args) => {
			this[privateProperties].next = this[containersChangeHandler](...args);
		});

		const watchedFilesList = templates.map(([templatePath]) => pathResolve(templatePath));
		const watchedFiles = chokidar.watch(watchedFilesList, { persistent: true });
		watchedFiles.on('change', (...args) => {
			this[privateProperties].next = this[containersChangeHandler](...args);
		});
		// this.on('update', containers => this[configurationGenerator](containers));
	}

	renderTemplate(templateContent = '') {

		const templateID = createHash('md5').update(templateContent).digest('hex');
		if (!this[privateProperties].templatesCache.includes(templateID)) {
			const compiledTemplate = Dust.compile(templateContent, templateID);
			Dust.loadSource(compiledTemplate);
			this[privateProperties].templatesCache.push(templateID);
		}

		return new Promise((res, rej) => {
			Dust.render(templateID, this[ctxKey], (err, out) => err ? rej(err) : res(out));
		});
	}

	async [containersChangeHandler](event) {

		await this[privateProperties].next;

		const { id: dockerId, status, Actor } = event;
		const reloadContainers = [];

		if (Actor) {
			const { Attributes: { name: containerName } } = Actor;
			debug('Recreate start by event from container: %s', containerName);
		} else {
			debug('Recreate start by initialize event');
		}

		let templatesCount = this[privateProperties].templates.length;
		while (templatesCount--) {

			const currentTemplate = this[privateProperties].templates[templatesCount];
			const [templatePath, destinationPath, dockerService] = currentTemplate;

			let canReloadContainer = true;
			if (dockerId && status !== 'initialized' && dockerService) {
				const fullContainerName = `/${dockerService}`;
				const sameContainers = await this[privateProperties].watcher
					.find({ dockerId, name: fullContainerName });

				canReloadContainer = sameContainers.length === 0;
			}

			const existsConfigHash = await getFileMD5(destinationPath);
			const templateSource = await readFile(templatePath);
			const configContent = await this.renderTemplate(templateSource);
			const currentTemplateHash = createHash('md5').update(configContent).digest('hex');
			if (existsConfigHash !== currentTemplateHash) {
				await writeFile(destinationPath, configContent);
				debug('Configuration file has been changed');

			} else {
				debug('Configuration file not changed');
				canReloadContainer = false;
			}

			if (this[privateProperties].dockerClient && dockerService && canReloadContainer) {
				if (!reloadContainers.includes(dockerService)) {
					reloadContainers.push(dockerService);
				}
			}

		}

		if (reloadContainers.length) {
			debug('Containers to reload', reloadContainers);
			const reloadPromise = reloadContainers
			.map(id => restartContainer(this[privateProperties].dockerClient, id));
			await Promise.all(reloadPromise);
			debug('Reloaded sucessful');
		} else {
			debug('No need to reload');
		}

	}
}
