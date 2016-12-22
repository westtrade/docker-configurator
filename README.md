# Configurator for docker containers

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
