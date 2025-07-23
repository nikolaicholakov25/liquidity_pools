#!/bin/bash

# Simple script to run yarn test 10 times

echo "Running yarn test 10 times..."

for i in {1..10}; do
    echo "Run #$i"
    yarn test
    echo "------------------------"
done

echo "All 10 runs completed!"
