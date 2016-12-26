# Configurator for docker containers

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/b335ba3878a242f08c89a0dad93a4919)](https://www.codacy.com/app/westtrade/docker-configurator?utm_source=github.com&utm_medium=referral&utm_content=westtrade/docker-configurator&utm_campaign=badger)

Generate configuration for docker container apps like nginx, from its metadata
such as ip, port or any environment variables. Watch for container changes and
reload container.

## Run outside of docker

Install docker-configurator with npm

```shell
npm i docker-configurator -g
```
or yarn way

```shell
yarn global add docker-configurator
```

Create next folder structure inside any folder

```
./
	config/
	template.dust
	service.conf
```

and run

```shell
docker-configurator
```



## Templates

### Helpers

**inspect**

**containers**

**json**
