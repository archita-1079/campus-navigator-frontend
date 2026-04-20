const sampleData = {
    "edges": [
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 22.038874008663424,
            "edgeType": "WALKWAY",
            "id": 1,
            "sourceNodeId": 1,
            "sourceNodeName": "Main Gate",
            "targetNodeId": 2,
            "targetNodeName": "Admin Block",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.26875,
                    "longitude": 78.00325
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 111.28375002183331,
            "edgeType": "WALKWAY",
            "id": 2,
            "sourceNodeId": 1,
            "sourceNodeName": "Main Gate",
            "targetNodeId": 3,
            "targetNodeName": "Central Library",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2688,
                    "longitude": 78.0032
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 50.92382147199376,
            "edgeType": "WALKWAY",
            "id": 3,
            "sourceNodeId": 2,
            "sourceNodeName": "Admin Block",
            "targetNodeId": 3,
            "targetNodeName": "Central Library",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.269,
                    "longitude": 78.00355
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 104.29073790790122,
            "edgeType": "WALKWAY",
            "id": 4,
            "sourceNodeId": 3,
            "sourceNodeName": "Central Library",
            "targetNodeId": 4,
            "targetNodeName": "CS Block",
            "waypointCount": 2,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2691,
                    "longitude": 78.004
                },
                {
                    "altitude": 0,
                    "latitude": 30.269,
                    "longitude": 78.0041
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 68.80170021173281,
            "edgeType": "WALKWAY",
            "id": 5,
            "sourceNodeId": 3,
            "sourceNodeName": "Central Library",
            "targetNodeId": 5,
            "targetNodeName": "Campus Cafeteria",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2692,
                    "longitude": 78.0041
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 67.69650184359273,
            "edgeType": "WALKWAY",
            "id": 6,
            "sourceNodeId": 5,
            "sourceNodeName": "Campus Cafeteria",
            "targetNodeId": 4,
            "targetNodeName": "CS Block",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2692,
                    "longitude": 78.0043
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 55.55197395991858,
            "edgeType": "WALKWAY",
            "id": 7,
            "sourceNodeId": 4,
            "sourceNodeName": "CS Block",
            "targetNodeId": 6,
            "targetNodeName": "Boys Hostel",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2697,
                    "longitude": 78.004
                }
            ]
        },
        {
            "accessible": true,
            "active": true,
            "bidirectional": true,
            "distance": 97.33217893001506,
            "edgeType": "WALKWAY",
            "id": 8,
            "sourceNodeId": 3,
            "sourceNodeName": "Central Library",
            "targetNodeId": 6,
            "targetNodeName": "Boys Hostel",
            "waypointCount": 1,
            "waypoints": [
                {
                    "altitude": 0,
                    "latitude": 30.2695,
                    "longitude": 78.0037
                }
            ]
        }
    ],
    "nodes": [
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:11:10.008446",
            "description": "Main entrance of campus",
            "extraInfo": "Security checkpoint",
            "floor": 0,
            "id": 1,
            "latitude": 30.2685,
            "longitude": 78.003,
            "name": "Main Gate",
            "nodeType": "ENTRANCE",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:11:45.105075",
            "description": "Administration building",
            "extraInfo": "Admissions and offices",
            "floor": 0,
            "id": 2,
            "latitude": 30.2689,
            "longitude": 78.0034,
            "name": "Admin Block",
            "nodeType": "BUILDING",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:13:08.329616",
            "description": "Main campus library",
            "extraInfo": "Study area and books",
            "floor": 0,
            "id": 3,
            "latitude": 30.2692,
            "longitude": 78.0038,
            "name": "Central Library",
            "nodeType": "BUILDING",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:13:15.465823",
            "description": "Computer Science department",
            "extraInfo": "Labs and classrooms",
            "floor": 0,
            "id": 4,
            "latitude": 30.2696,
            "longitude": 78.0042,
            "name": "CS Block",
            "nodeType": "BUILDING",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:13:40.422473",
            "description": "Food court",
            "extraInfo": "Open from 8 AM",
            "floor": 0,
            "id": 5,
            "latitude": 30.2693,
            "longitude": 78.0045,
            "name": "Campus Cafeteria",
            "nodeType": "CANTEEN",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:13:50.257325",
            "description": "Student hostel",
            "extraInfo": "Residential building",
            "floor": 0,
            "id": 6,
            "latitude": 30.27,
            "longitude": 78.004,
            "name": "Boys Hostel",
            "nodeType": "HOSTEL",
            "parentNodeId": null,
            "parentNodeName": null
        },
        {
            "accessible": false,
            "active": true,
            "childNodes": null,
            "createdAt": "2026-04-08T04:14:01.465941",
            "description": "Events and seminars",
            "extraInfo": "Large hall",
            "floor": 0,
            "id": 7,
            "latitude": 30.2697,
            "longitude": 78.0036,
            "name": "Auditorium",
            "nodeType": "AUDITORIUM",
            "parentNodeId": null,
            "parentNodeName": null
        }
    ]
}

export default sampleData;