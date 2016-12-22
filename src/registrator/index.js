/**
* @Author: Popov Gennadiy
* @Date:   2016-11-25T04:54:02+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-22T02:47:34+03:00
*/

'use strict';

import createDebugLog from 'debug';
import EventEmmiter from 'events';
import Datastore from 'nedb-promise';
import { createHash } from 'crypto';

import { tryCatch } from '../utils';
import { name } from '../../package.json';

const debug = createDebugLog(`${name}-watcher`);

/**
 * Reducer for container environment variables, reduce list to standart Object
 * @param  {Object} result     Result object of reduce
 * @param  {String} currentRow Raw environment variable
 * @return {Object}            Mapped environment variables
 */
const envParser = (result, currentRow) => {
	const [key, values] = currentRow.split('=');
	result[key] = values;
	return result;
};

/**
 * Mapper for object id
 * @param  {String} idString Docker container id
 * @return {String}          Modified container id
 */
const objectID = idString => idString.substring(0, 24);

/**
 * Mapper for container info
 * @param  {Object} [containerInfo={}] Default container info from docker api
 * @return {Object} [mappedContainerInfo={id, dockerId: Id, network, name, env}]
 *  Mapped container info
 */
const composeContainerInfo = (containerInfo = {}) => {

	let {
			Name: name,
			Id,
			NetworkSettings: { Networks, Ports },
			Config: { Env: env },
		} = containerInfo;

	env = env.reduce(envParser, {});

	const containerAddress = Object.values(Networks).map(network => network.IPAddress);
	let network = null;
	if (Ports) {

		const ports = Object.keys(Ports)
			.filter(port => port.indexOf('udp') < 0)
			.map(port => port.split('/')[0]);

		[network] = containerAddress.reduce((result, ip) => {
			result.push({ ip, ports });
			return result;
		}, []);
	}


	const id = objectID(Id);
	const mappedContainerInfo = { id, dockerId: Id, network, name, env };
	mappedContainerInfo.hash = createHash('md5').update(JSON.stringify(mappedContainerInfo)).digest('hex');
	return mappedContainerInfo;
};

/**
 * Private properties key
 * @type {Symbol}
 */
const privateKey = Symbol('private properties');

/**
 * Key of class private method for store updates
 * @type {Symbol}
 */
const privateMethodUpdate = Symbol('update store method');

/**
 * Key of class private method for getting docker containers list
 * @type {Symbol}
 */
const privateMethodGetContainers = Symbol('get docker containers method');

/**
 * Key of class private method for inspecting docker container
 * @type {Symbol}
 */
const privateMethodInspectContainers = Symbol('inspect docker container method');


const eventHandler = Symbol('Docker events handler');


/**
* ContainersWatcher - Description
* @extends EventEmmiter
*/
export default class ContainersWatcher extends EventEmmiter {

	/**
	 * constructor
	 *
	 * @param {object} Unknown                   Settings
	 * @param {type}   Unknown.dockerClient      Description
	 * @param {type}   Unknown.datastoreSettings Description
	 *
	 * @return {type} Description
	 */
	constructor({ dockerClient, datastoreSettings }) {

		super();

		this[privateKey] = {
			client: dockerClient,
			store: new Datastore(datastoreSettings),
			allowedStatus: ['start', 'stop', 'destroy'],
			isInitalized: false,
			next: Promise.resolve(),
		};

		this[privateKey].next = this[privateMethodUpdate]();

		dockerClient.getEvents((error, stream) => {

			if (error) {
				return this.emit('error', error);
			}

			stream.on('data', (evBuf) => {
				this[privateKey].next = this[eventHandler](evBuf).catch(e => this.emit('error', e));
			});
		});
	}

	async [eventHandler](eventBuffer) {

		await this[privateKey].next;

		if (!this[privateKey].isInitalized) {
			this[privateKey].isInitalized = true;
		}

		const [jsonError, eventData] = tryCatch(() => JSON.parse(eventBuffer.toString('utf-8')));

		if (jsonError) {
			return this.emit(jsonError);
		}

		const { status, Type } = eventData;
		const eventIsNecessary = this[privateKey].allowedStatus.includes(status)
			&& Type === 'container';

		if (eventIsNecessary) {
			await this[privateKey].store.ensureIndex({ fieldName: 'dockerId', unqiue: true });
			await this[privateMethodUpdate](eventData);
			await this[privateKey].store.removeIndex('dockerId');
		}
	}

	/**
	 * isInitalized - Description
	 *
	 * @return {type} Description
	 */
	get isInitalized() {
		return this[privateKey].isInitalized;
	}

	/**
	 * find - Description
	 *
	 * @param {array} args Description
	 *
	 * @return {type} Description
	 */
	find(...args) {
		return this[privateKey].store.find(...args);
	}

	/**
	 * privateMethodUpdate - Description
	 *
	 * @param {type} event Description
	 *
	 * @return {type} Description
	 */
	async [privateMethodUpdate](event) {

		debug('Update container list start');
		let deleted = await this[privateKey].store.find({});
		const duplicatedContainers = deleted.reduce((result, containerInfo) => {

			const { id } = containerInfo;
			const { unique, duplicated } = result;
			unique.includes(id) ? duplicated.push(id) : unique.push(id);
			return { unique, duplicated };

		}, { unique: [], duplicated: [] });

		const { duplicated } = duplicatedContainers;
		if (duplicated.length) {

			const removeQuery = {
				id: { $in: duplicated },
			};

			debug('Remove duplcated items %j, duplcatedItems: %s', removeQuery, duplicated);
			const totalRemoved = await this[privateKey].store.remove(removeQuery, { multi: true });
			debug('Total removed %s', totalRemoved);

			deleted = await this[privateKey].store.find({});
		}

		deleted = deleted.reduce((result, current) => {
			const { id } = current;
			result[id] = current;
			return result;
		}, {});

		const created = {};
		const updated = {};

		const containersList = await this[privateMethodGetContainers]();
		let containersCount = containersList.length;
		while (containersCount--) {

			const { Id } = containersList[containersCount];
			let containerInfo = await this[privateMethodInspectContainers](Id);
			containerInfo = composeContainerInfo(containerInfo);

			const { id } = containerInfo;
			if (id in deleted) {

				if (containerInfo.hash !== deleted[id].hash) {
					const updateInfo = Object.assign({}, containerInfo);
					updated[id] = updateInfo;
				}

				delete deleted[id];

			} else {
				created[id] = containerInfo;
			}
		}

		let totalRemoved = 0;
		if (Object.keys(deleted).length !== 0) {

			const removeQuery = {
				_id: {
					$in: Object.values(deleted).map(item => item._id),
				},
			};

			debug('Remove query %j, removedItems %j', removeQuery, deleted);
			totalRemoved = await this[privateKey].store.remove(removeQuery, { multi: true });
		}

		let totalUpdated = 0;
		if (Object.keys(updated).length !== 0) {
			const updatedItems = Object.entries(updated);
			let entriesCount = updatedItems.length;
			while (entriesCount--) {
				const [id, updateInfo] = updatedItems[entriesCount];
				const updatedItemsCount = await this[privateKey]
					.store.update({ id }, updateInfo, { upsert: true });

				totalUpdated += updatedItemsCount;
			}
		}

		let totalCreated = 0;
		if (Object.keys(created).length !== 0) {
			const newItems = await this[privateKey].store.insert(Object.values(created));
			totalCreated = newItems.length;
		}

		const totalItems = await this[privateKey].store.count({});
		debug('Event with changes has happened');
		if (totalCreated > 0 || totalCreated > 0 || totalRemoved > 0 || !this.isInitalized) {

			debug(`

	  Containers list has been changed
	--------------------------------------------------------------------------------
	  created: ${totalCreated}
	  updated: ${totalUpdated}
	  deleted: ${totalRemoved}
	--------------------------------------------------------------------------------
	  total in store: ${totalItems}
	  total in docker: ${containersList.length}
	================================================================================
			`);

			const additionalEventData = {
				created: totalCreated,
				updated: totalUpdated,
				removed: totalRemoved,
			};

			if (!this.isInitalized) {
				additionalEventData.status = 'initialized';
			}

			event = Object.assign({}, event, additionalEventData);
			this.emit('change', event);
		}

		debug('Update container list end');
	}

	[privateMethodGetContainers]() {
		return new Promise((resolve, reject) => {
			const promiseCallback = (error, result) => error ? reject(error) : resolve(result);
			this[privateKey].client.listContainers(promiseCallback);
		});
	}

	[privateMethodInspectContainers](containerId) {
		return new Promise((resolve, reject) => {
			const promiseCallback = (error, result) => error ? reject(error) : resolve(result);
			this[privateKey].client.getContainer(containerId).inspect(promiseCallback);
		});
	}
}
