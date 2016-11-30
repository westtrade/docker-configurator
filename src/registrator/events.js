/**
* @Author: Popov Gennadiy
* @Date:   2016-11-25T04:54:02+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-11-29T14:17:39+03:00
*/

import createDebugLog from 'debug';
import EventEmmiter from 'events';
import Datastore from 'nedb-promise';
import { createHash } from 'crypto';

const debug = createDebugLog('docker-gen-container-watcher');

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
	const ports = Object.keys(Ports)
		.filter(port => port.indexOf('udp') < 0)
		.map(port => port.split('/')[0]);

	const [network] = containerAddress.reduce((result, ip) => {
		result.push({ ip, ports });
		return result;
	}, []);

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

export default class containersWatcher extends EventEmmiter {

	constructor({ dockerClient, datastoreSettings }) {

		super();

		this[privateKey] = {
			client: dockerClient,
			store: new Datastore(datastoreSettings),
			allowedStatus: ['start', 'stop', 'destroy'],
			isInitalized: false,
		};

		this[privateKey].store.ensureIndex({ fieldName: 'dockerId', unique: true });

		this[privateMethodUpdate]()
			.catch(e => this.emit('error', e))
			.then(() => {
				this[privateKey].isInitalized = true;
			});

		dockerClient.getEvents((error, stream) => {

			if (error) {
				this.emit('error', error);
				return;
			}

			stream.on('data', async (eventBuffer) => {

				try {
					const data = JSON.parse(eventBuffer.toString('utf-8'));
					const { status, Type, id: containerId } = data;
					const eventIsNecessary = this[privateKey].allowedStatus.includes(status)
						&& Type === 'container';

					if (eventIsNecessary) {
						await this[privateMethodUpdate](data);
					}
				} catch (e) {
					this.emit('error', e);
				}

			});
		});
	}

	get isInitalized() {
		return this[privateKey].isInitalized;
	}

	find(...args) {
		return this[privateKey].store.find(...args);
	}

	async [privateMethodUpdate](event) {

		let deleted = await this[privateKey].store.find({});
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

			debug('Remove query %j, removedItems', removeQuery, deleted);
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

		if (totalCreated > 0 || totalCreated > 0 || totalRemoved > 0 || !this.isInitalized) {
			const additionalEventData = {
				created: totalCreated,
				updated: totalUpdated,
				removed: totalRemoved,
				isInitialization: !this.isInitalized,
			};
			event = Object.assign({}, event, additionalEventData);
			this.emit('change', event);
		}
	}

	[privateMethodGetContainers]() {
		return new Promise((resolve, reject) => {
			const promiseCallback = (error, result) => error ? reject(error) : resolve(result);
			this[privateKey].client.listContainers(promiseCallback);
		}).catch(error => this.emit('error', error));
	}

	[privateMethodInspectContainers](containerId) {
		return new Promise((resolve, reject) => {
			const promiseCallback = (error, result) => error ? reject(error) : resolve(result);
			this[privateKey].client.getContainer(containerId).inspect(promiseCallback);
		}).catch(error => this.emit('error', error));
	}
}
