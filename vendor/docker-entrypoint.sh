#!/bin/bash

echo "Starting Xvfb"
Xvfb :99 -ac &
sleep 2

export DISPLAY=:99
echo "Executing command $@"

pwd

ls -la /
ls -la /app
ls -la /tmp
ls -la ./dist/


exec "$@"

ls -la ./dist/
