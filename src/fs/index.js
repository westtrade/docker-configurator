/**
* @author: Popov Gennadiy <dio>
* @Date:   2016-11-26T11:27:20+03:00
* @email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-22T01:31:53+03:00
*/

'use strict';

import fs from 'fs';
import { createHash } from 'crypto';

export const readFile = (filePath, encode = 'UTF-8') => new Promise((resolve, reject) => {
	fs.readFile(filePath, encode, (error, fileContent) => {
		if (error) {
			return reject(error);
		}

		return resolve(fileContent);
	});
});

export const writeFile = (filePath, fileContent) => new Promise((resolve, reject) => {
	fs.writeFile(filePath, fileContent, (error) => {
		if (error) {
			return reject(error);
		}

		return resolve();
	});
});

export const restartContainer = (dockerClient, containerId) => new Promise((resolve, reject) => {
	dockerClient.getContainer(containerId).restart((error, result) => {
		if (error) {
			return reject(error);
		}

		return resolve(result);
	});
});

export const getFileMD5 = filePath => new Promise((resolve) => {
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
