/**
* @Author: Popov Gennadiy <dio>
* @Date:   2016-11-26T10:54:35+03:00
* @Email:  me@westtrade.tk
* @Last modified by:   dio
* @Last modified time: 2016-11-26T11:26:33+03:00
*/


export const argvReducer = (short, full, propertyName) => {

	const argKeys = [short, full];
	return (resultObject, currentArg, currentIdx, argv) => {

		let [argKey, argValue] = currentArg.split('=');
		if (!argKeys.includes(argKey)) {
			return resultObject;
		}

		if (!argValue) {
			const nextIndex = currentIdx + 1;
			if (nextIndex > argv.length) {
				return resultObject;
			}

			const nextArg = argv[nextIndex];
			if (nextArg.indexOf('-') === 0) {
				return resultObject;
			}

			argValue = nextArg;
		}

		let { [propertyName]: value } = resultObject;
		switch (typeof value) {
		case 'array':
			value.push(argValue);
			break;
		case 'undefined':
			value = argValue;
			break;
		default:
			value = [value, argValue];
		}

		resultObject[propertyName] = value;
		return resultObject;
	};
};
