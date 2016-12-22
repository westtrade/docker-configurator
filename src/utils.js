/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-30T12:02:20+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-12-22T04:21:12+03:00
*/

'use strict';

export const tryCatch = (fn) => {

	let [error, result] = [null, null];
	try {
		result = fn();
	} catch (e) {
		error = e;
	}

	return [error, result];
};


export const convertRegexpParams = inputObject => Object.keys(inputObject)
	.reduce((result, currentKey) => {

		if (typeof inputObject[currentKey] === 'object') {
			result[currentKey] = convertRegexpParams(inputObject[currentKey]);
		}

		if (currentKey === '$regex') {
			result[currentKey] = new RegExp(inputObject[currentKey].trim());
		}

		return result;
	}, {});
