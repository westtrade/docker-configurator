FROM node:alpine

MAINTAINER Gennadiy Popov <me@westtrade.tk>

RUN apk add --no-cache make build-base gcc g++ python

WORKDIR /opt/
# Install yarn from the local .tgz
ADD https://yarnpkg.com/latest.tar.gz ./
RUN tar -xf latest.tar.gz && \
	mv /opt/dist /opt/yarn && \
	rm latest.tar.gz

ENV NODE_CONFIG_STRICT_MODE "false"
ENV NODE_ENV "production"
ENV DEBUG "docker-configurator-*"

ENV PATH "$PATH:/opt/yarn/bin"

# Install docker configurator
WORKDIR /etc/docker-configurator
ADD . .
VOLUME ["/etc/docker-configurator/config"]
COPY ./config "/etc/docker-configurator/config"
RUN yarn
CMD ["npm", "start"]
