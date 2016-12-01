/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-30T12:02:20+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-11-30T12:06:22+03:00
*/

export const tryCatch = (fn) => {
	try {
		return [null, fn()];
	} catch (e) {
		return [e, null];
	}
};
