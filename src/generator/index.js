/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-26T11:27:20+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-22T04:24:44+03:00
*/

'use strict';

import createDebugLog from 'debug';
import EventEmmiter from 'events';
import Dust from 'dustjs-linkedin';
import MongoQS from 'mongo-querystring';
import chokidar from 'chokidar';
import qs from 'qs';
import { resolve as pathResolve } from 'path';
import { createHash } from 'crypto';
import assert from 'assert';

import { readFile, writeFile, restartContainer, getFileMD5 } from '../fs';
import { name } from '../../package.json';
import { tryCatch, convertRegexpParams } from '../utils';

const debug = createDebugLog(`${name}-generator`);

const privateProperties = Symbol('Private options property');
const containersChangeHandler = Symbol('Container changed event handler');
const renderContextKey = Symbol('Render context');


Dust.optimizers.format = (ctx, node) => node;

export default class ConfigurationGenerator extends EventEmmiter {

	constructor({ dockerClient, templates, watcher }) {

		templates = templates || [];
		if (typeof templates === 'string') {
			templates = [templates];
		}

		assert(typeof templates, 'Argument templates must be an Array');
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

		/**
		 * @namespace
		 * @property {object} 	Context		File rendering context
		 */
		this[renderContextKey] = {

			inspect(chunk, context, bodies, params) {

				const { dockerId } = Object.assign({}, { dockerId: '' }, params);

				assert(dockerId && dockerId.length, 'dockerId is required');
				assert.equal(typeof dockerId, 'string', 'dockerId must be a string');

				const result = new Promise((resolve, reject) => {
					const container = dockerClient.getContainer(dockerId);
					container.inspect((dockerError, containerData) => dockerError
						? reject(dockerError)
						: resolve(containerData));
				}).catch(e => me.emit('error', e));

				return result;

			},

			containers(chunk, context, bodies, params) {

				// const mongoQs = new MongoQS();

				let { query } = Object.assign({}, { query: '' }, params);
				query = qs.parse(query);
				query = convertRegexpParams(query);
				const resultPromise = watcher.find(query)
					.catch(e => me.emit('error', e));

				return resultPromise;
			},

			json(chunk, context) {

				const [jsonError, resultString] = tryCatch(() => {
					const { stack: { head } } = context;
					return JSON.stringify(head, null, 2);
				});

				if (jsonError) {
					me.emit('error', jsonError);
					chunk.setError(jsonError);
				} else {
					chunk.write(resultString);
				}
			},
		};

		watcher.on('error', watcherError => this.emit('error', watcherError));
		watcher.on('change', (...args) => {
			debug('Containers list changed');
			const next = this[containersChangeHandler](...args);
			this[privateProperties].next = next.catch(reasonError => this.emit('error', reasonError));
		});

		const watchedFilesList = templates.map(([templatePath]) => pathResolve(templatePath));
		const watchedFiles = chokidar.watch(watchedFilesList, { persistent: true });
		watchedFiles.on('change', (...args) => {
			debug('Tempalte changed');
			const next = this[containersChangeHandler](...args);
			this[privateProperties].next = next.catch(reasonError => this.emit('error', reasonError));
		});
		// this.on('update', containers => this[configurationGenerator](containers));
	}

	renderTemplate(templateContent = '') {

		const templateID = createHash('md5').update(templateContent).digest('hex');
		debug('Render template. Template source hash: %s', templateID);
		if (!this[privateProperties].templatesCache.includes(templateID)) {
			debug('Template does not exists, create it from string');
			const compiledTemplate = Dust.compile(templateContent, templateID);
			Dust.loadSource(compiledTemplate);
			this[privateProperties].templatesCache.push(templateID);
		}

		return new Promise((res, rej) => {
			Dust.render(templateID, this[renderContextKey], (err, out) => err ? rej(err) : res(out));
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
				debug('Configuration file has been changed, and will recreated');
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
